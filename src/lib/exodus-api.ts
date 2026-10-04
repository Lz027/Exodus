// Data boundary for Exodus. UI talks only to these helpers so the backend stays replaceable.
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { Availability, ProfileKey } from "@/lib/ai/registry";

export type Project = Tables<"projects">;
export type Conversation = Tables<"conversations">;
export type Message = Tables<"messages">;
export type Task = Tables<"tasks">;
export type Memory = Tables<"project_memory">;
export type ProjectFile = Tables<"project_files">;
export type Activity = Tables<"activity_events">;
export type Workspace = "general" | "coding";

const must = <T,>({ data, error }: { data: T | null; error: { message: string } | null }) => { if (error) throw new Error(error.message); return data as T; };

export function useSession() {
  const [state, setState] = useState<{ session: Session | null; ready: boolean }>({ session: null, ready: false });
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, ready: true }));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setState({ session, ready: true }));
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}
export const uid = async () => { const { data } = await supabase.auth.getUser(); if (!data.user) throw new Error("Please sign in again."); return data.user.id; };

export const q = {
  profile: () => queryOptions({ queryKey: ["profile"], queryFn: async () => must(await supabase.from("profiles").select("*").maybeSingle()) }),
  projects: () => queryOptions({ queryKey: ["projects"], queryFn: async () => must(await supabase.from("projects").select("*").order("updated_at", { ascending: false })) ?? [] }),
  conversations: () => queryOptions({ queryKey: ["conversations"], queryFn: async () => must(await supabase.from("conversations").select("*").order("updated_at", { ascending: false }).limit(100)) ?? [] }),
  messages: (id: string) => queryOptions({ queryKey: ["messages", id], queryFn: async () => must(await supabase.from("messages").select("*").eq("conversation_id", id).order("created_at")) ?? [] }),
  tasks: (pid: string) => queryOptions({ queryKey: ["tasks", pid], queryFn: async () => must(await supabase.from("tasks").select("*").eq("project_id", pid).order("created_at")) ?? [] }),
  memory: (pid: string) => queryOptions({ queryKey: ["memory", pid], queryFn: async () => must(await supabase.from("project_memory").select("*").eq("project_id", pid).order("created_at", { ascending: false })) ?? [] }),
  files: (pid: string) => queryOptions({ queryKey: ["files", pid], queryFn: async () => must(await supabase.from("project_files").select("*").eq("project_id", pid).order("created_at", { ascending: false })) ?? [] }),
  activity: (pid: string) => queryOptions({ queryKey: ["activity", pid], queryFn: async () => must(await supabase.from("activity_events").select("*").eq("project_id", pid).order("created_at", { ascending: false }).limit(40)) ?? [] }),
};

export const api = {
  async createConversation(workspace: Workspace, projectId: string | null, profile: ProfileKey) {
    return must(await supabase.from("conversations").insert({ user_id: await uid(), workspace_type: workspace, project_id: projectId, model_profile: profile }).select("*").single()) as Conversation;
  },
  async renameConversation(id: string, title: string) { must(await supabase.from("conversations").update({ title }).eq("id", id)); },
  async deleteConversation(id: string) { must(await supabase.from("messages").delete().eq("conversation_id", id)); must(await supabase.from("conversations").delete().eq("id", id)); },
  async addUserMessage(conversationId: string, content: string, clientRequestId: string, attachments: unknown[] = []) {
    const { data, error } = await supabase.from("messages").insert({ conversation_id: conversationId, user_id: await uid(), role: "user", content, client_request_id: clientRequestId, attachments: attachments as never }).select("*").single();
    if (error && error.code === "23505") throw new Error("This message was already sent.");
    if (error) throw new Error(error.message);
    return data as Message;
  },
  async updateMessage(id: string, content: string) { must(await supabase.from("messages").update({ content }).eq("id", id)); },
  async deleteMessagesAfter(conversationId: string, createdAt: string, inclusive = false) {
    const b = supabase.from("messages").delete().eq("conversation_id", conversationId);
    must(await (inclusive ? b.gte("created_at", createdAt) : b.gt("created_at", createdAt)));
  },
  async createProject(p: { name: string; description: string; project_type: string; starting_stack: string; design_direction: string; complexity: string; repository_status: string }) {
    const user_id = await uid();
    const row = must(await supabase.from("projects").insert({ ...p, user_id }).select("*").single()) as Project;
    await supabase.from("activity_events").insert({ user_id, project_id: row.id, event_type: "project_created", title: "Project created" });
    return row;
  },
  async deleteProject(id: string) { must(await supabase.from("projects").delete().eq("id", id)); },
  async addTask(project_id: string, title: string) { const user_id = await uid(); must(await supabase.from("tasks").insert({ project_id, user_id, title })); await supabase.from("activity_events").insert({ user_id, project_id, event_type: "task_added", title: `Task added: ${title}` }); },
  async setTaskStatus(id: string, status: string) { must(await supabase.from("tasks").update({ status }).eq("id", id)); },
  async deleteTask(id: string) { must(await supabase.from("tasks").delete().eq("id", id)); },
  async addMemory(project_id: string, content: string) { must(await supabase.from("project_memory").insert({ project_id, user_id: await uid(), content, pinned: true })); },
  async toggleMemory(id: string, pinned: boolean) { must(await supabase.from("project_memory").update({ pinned }).eq("id", id)); },
  async deleteMemory(id: string) { must(await supabase.from("project_memory").delete().eq("id", id)); },
  async uploadFile(project_id: string, file: File) {
    if (file.size > 10 * 1024 * 1024) throw new Error("Files must be 10 MB or smaller.");
    const user_id = await uid();
    const path = `${user_id}/${project_id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await supabase.storage.from("exodus-files").upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (up.error) throw new Error(up.error.message);
    must(await supabase.from("project_files").insert({ project_id, user_id, file_name: file.name, file_type: file.type || "file", file_size: file.size, storage_path: path }));
    await supabase.from("activity_events").insert({ user_id, project_id, event_type: "file_uploaded", title: `Uploaded ${file.name}` });
  },
  async deleteFile(f: ProjectFile) { await supabase.storage.from("exodus-files").remove([f.storage_path]); must(await supabase.from("project_files").delete().eq("id", f.id)); },
  async fileUrl(f: ProjectFile) { const { data } = await supabase.storage.from("exodus-files").createSignedUrl(f.storage_path, 300); return data?.signedUrl ?? null; },
  async signOut() { await supabase.auth.signOut(); },
};

// ---------- AI client (talks to our own server routes; no provider keys here) ----------
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}
export class AiError extends Error { constructor(message: string, public code: string, public status: number) { super(message); } }
async function fail(res: Response): Promise<never> {
  const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  throw new AiError(j.error ?? "Something went wrong. Please try again.", j.code ?? "unknown", res.status);
}

export type ModelsInfo = { availability: Availability; keyStatus: "connected" | "missing" | "error"; checkedAt: number | null };
export function useModels() {
  return useQuery({ queryKey: ["ai-models"], refetchInterval: 120_000, staleTime: 60_000, queryFn: async (): Promise<ModelsInfo> => { const r = await fetch("/api/ai/models", { headers: await authHeaders() }); if (!r.ok) await fail(r); return r.json(); } });
}

export type StreamEvent = { type: "meta"; label: string; profile: ProfileKey; fallbackUsed: boolean; notice: string } | { type: "delta"; text: string } | { type: "done"; id: string | null; title?: string } | { type: "error"; error: string };
export async function streamChat(body: { conversationId: string; profile: ProfileKey; clientRequestId: string; images?: string[]; allowKimiFallback?: boolean; confirmLarge?: boolean }, signal: AbortSignal, onEvent: (e: StreamEvent) => void) {
  const res = await fetch("/api/ai/chat", { method: "POST", signal, headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) await fail(res);
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const l of lines) if (l.trim()) { try { onEvent(JSON.parse(l)); } catch { /* skip */ } }
  }
}
export async function transcribe(blob: Blob) {
  const fd = new FormData(); fd.append("audio", blob, "voice.webm");
  const r = await fetch("/api/ai/transcribe", { method: "POST", body: fd, headers: await authHeaders() }); if (!r.ok) await fail(r);
  return ((await r.json()) as { text: string }).text;
}
export async function speak(text: string, signal?: AbortSignal) {
  const r = await fetch("/api/ai/speak", { method: "POST", signal: signal ?? null, headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ text }) }); if (!r.ok) await fail(r);
  return URL.createObjectURL(await r.blob());
}
export type UsageInfo = { provider: string; keyStatus: string; availability: Availability; requests: number; inputTokens: number; outputTokens: number; fallbacks: number; rateLimits: number; errors: number; lastRequestAt: string | null };
export async function fetchUsage(since?: string): Promise<UsageInfo> { const r = await fetch(`/api/ai/usage${since ? `?since=${encodeURIComponent(since)}` : ""}`, { headers: await authHeaders() }); if (!r.ok) await fail(r); return r.json(); }
export async function clearUsage() { const r = await fetch("/api/ai/usage", { method: "DELETE", headers: await authHeaders() }); if (!r.ok) await fail(r); }
export function sessionStart() { if (typeof window === "undefined") return undefined; let s = sessionStorage.getItem("exodus:session-start"); if (!s) { s = new Date().toISOString(); sessionStorage.setItem("exodus:session-start", s); } return s; }

export const prefs = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(`exodus:${k}`); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(`exodus:${k}`, JSON.stringify(v)); } catch { /* ignore */ } },
};
