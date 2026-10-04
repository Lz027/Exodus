import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { claimConversation, errorResponse, groqFetch, PublicError, requireUser, resolveProfile, throttle, utilityCompletion } from "@/lib/ai/groq.server";
import { estimateTokens, limits, LARGE_CONFIRM, PROVIDER, type ProfileKey } from "@/lib/ai/registry";
import { systemPrompts } from "@/lib/ai/prompts";

const Body = z.object({
  conversationId: z.string().uuid(),
  profile: z.enum(["kimi", "general", "fast", "deep", "reasoning", "vision"]),
  clientRequestId: z.string().min(8).max(80),
  images: z.array(z.string().startsWith("data:image/").max(Math.ceil(limits.maxImageBytes * 1.4))).max(limits.maxImages).optional(),
  allowKimiFallback: z.boolean().optional(),
  confirmLarge: z.boolean().optional(),
});

type GroqMsg = { role: "system" | "user" | "assistant"; content: string | unknown[] };

export const Route = createFileRoute("/api/ai/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let release: (() => void) | null = null;
        try {
          const { supabase, userId } = await requireUser(request);
          const body = Body.parse(await request.json());
          const log = (kind: string, extra: Record<string, unknown> = {}) =>
            supabase.from("usage_events").insert({ user_id: userId, conversation_id: body.conversationId, kind, ...extra }).then(() => {}, () => {});

          const { data: convo } = await supabase.from("conversations").select("*").eq("id", body.conversationId).maybeSingle();
          if (!convo) throw new PublicError("This conversation no longer exists.", 404, "not_found");

          // Duplicate protection: an assistant reply already exists for this request.
          const { data: dupe } = await supabase.from("messages").select("id").eq("conversation_id", convo.id).eq("role", "assistant").eq("client_request_id", body.clientRequestId).maybeSingle();
          if (dupe) throw new PublicError("This message was already answered.", 409, "duplicate");

          throttle(userId);
          release = claimConversation(convo.id);

          const { data: history } = await supabase.from("messages").select("role,content,status").eq("conversation_id", convo.id).order("created_at", { ascending: false }).limit(limits.maxHistoryMessages);
          let msgs = (history ?? []).reverse().filter((m) => m.content.trim() && m.status !== "error");
          if (!msgs.length || msgs[msgs.length - 1]!.role !== "user") throw new PublicError("There’s no message to answer yet.", 400, "invalid");

          const hasImages = !!body.images?.length;
          const requestedKey: ProfileKey = hasImages ? "vision" : body.profile;
          let res;
          try { res = await resolveProfile(requestedKey, !!body.allowKimiFallback); }
          catch (e) { if (e instanceof PublicError && e.code === "kimi_unavailable") await log("fallback", { capability: "coding", requested_model_id: "moonshotai/kimi-k2-instruct-0905", detail: "kimi unavailable, request held" }); throw e; }
          const { profile, requested, fallbackUsed, fallbackReason } = res;

          let context = "";
          if (convo.project_id) {
            const [{ data: project }, { data: memory }] = await Promise.all([
              supabase.from("projects").select("name,description,status,starting_stack").eq("id", convo.project_id).maybeSingle(),
              supabase.from("project_memory").select("content").eq("project_id", convo.project_id).eq("pinned", true).limit(20),
            ]);
            if (project) context += `\n\nActive project: ${project.name} (${project.status}). ${project.description} Stack: ${project.starting_stack || "not chosen"}.`;
            if (memory?.length) context += `\nPinned project memory:\n${memory.map((m) => `- ${m.content}`).join("\n")}`;
            context = context.slice(0, limits.projectContextChars);
          }
          const system = (profile.key === "vision" ? systemPrompts.vision : convo.workspace_type === "coding" ? systemPrompts.coding : systemPrompts.general) + context;

          // Trim oldest history to fit the input budget (always keep the latest user message).
          const budget = profile.budget.maxInputTokens - estimateTokens(system);
          while (msgs.length > 1 && msgs.reduce((n, m) => n + estimateTokens(m.content), 0) > budget) msgs = msgs.slice(1);
          const inputEstimate = estimateTokens(system) + msgs.reduce((n, m) => n + estimateTokens(m.content), 0) + (hasImages ? 1500 * body.images!.length : 0);
          if (inputEstimate > profile.budget.maxInputTokens + 2000) throw new PublicError("This message is too long for the selected model. Shorten it or start a new chat.", 400, "invalid");
          if (inputEstimate > limits.largeContextTokens && !body.confirmLarge) throw new PublicError(LARGE_CONFIRM, 409, "large_context");

          const messages: GroqMsg[] = [{ role: "system", content: system }, ...msgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))];
          if (hasImages) {
            const last = messages[messages.length - 1]!;
            last.content = [{ type: "text", text: String(last.content) }, ...body.images!.map((url) => ({ type: "image_url", image_url: { url } }))];
          }

          const isOss = profile.modelId.startsWith("openai/gpt-oss");
          const upstream = await groqFetch("/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: request.signal,
            onRateLimit: () => void log("rate_limit", { capability: profile.capability, actual_model_id: profile.modelId }),
            body: JSON.stringify({ model: profile.modelId, messages, stream: true, max_completion_tokens: profile.budget.maxOutputTokens, ...(isOss ? { include_reasoning: false, reasoning_effort: profile.key === "deep" ? "medium" : "low" } : { temperature: 0.6 }) }),
          });

          const enc = new TextEncoder();
          const send = (c: ReadableStreamDefaultController, e: object) => { try { c.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { /* closed */ } };
          let full = "";
          let usage = { in: inputEstimate, out: 0, exact: false };
          const notice = fallbackUsed ? `${requested.label} was unavailable. This response used ${profile.label}.` : "";
          const persist = async (status: "completed" | "stopped" | "error") => {
            if (!full.trim() && status !== "completed") return null;
            const out = usage.exact ? usage.out : estimateTokens(full);
            const { data } = await supabase.from("messages").insert({
              conversation_id: convo.id, user_id: userId, role: "assistant", content: full, model: profile.modelId, requested_model_id: requested.modelId,
              model_label: profile.label, provider: PROVIDER, capability: profile.capability, fallback_used: fallbackUsed, fallback_reason: fallbackReason,
              status, client_request_id: body.clientRequestId, input_tokens: usage.in, output_tokens: out,
            }).select("id").single();
            await supabase.from("conversations").update({ updated_at: new Date().toISOString(), model_profile: body.profile }).eq("id", convo.id);
            await log("request", { capability: profile.capability, requested_model_id: requested.modelId, actual_model_id: profile.modelId, input_tokens: usage.in, output_tokens: out, detail: status });
            if (fallbackUsed) await log("fallback", { capability: profile.capability, requested_model_id: requested.modelId, actual_model_id: profile.modelId, detail: fallbackReason });
            return data?.id ?? null;
          };

          const done = release; release = null;
          const stream = new ReadableStream({
            async start(c) {
              send(c, { type: "meta", label: profile.label, profile: profile.key, fallbackUsed, notice });
              const reader = upstream.body!.getReader();
              const dec = new TextDecoder();
              let buf = "";
              try {
                for (;;) {
                  const { value, done: end } = await reader.read();
                  if (end) break;
                  buf += dec.decode(value, { stream: true });
                  const lines = buf.split("\n");
                  buf = lines.pop() ?? "";
                  for (const line of lines) {
                    const t = line.trim();
                    if (!t.startsWith("data:")) continue;
                    const payload = t.slice(5).trim();
                    if (payload === "[DONE]") continue;
                    try {
                      const j = JSON.parse(payload);
                      const u = j.x_groq?.usage ?? j.usage;
                      if (u?.prompt_tokens) usage = { in: u.prompt_tokens, out: u.completion_tokens ?? 0, exact: true };
                      const delta = j.choices?.[0]?.delta?.content;
                      if (delta) { full += delta; send(c, { type: "delta", text: delta }); }
                    } catch { /* partial frame */ }
                  }
                }
                const id = await persist("completed");
                let title: string | undefined;
                if (convo.title === "New conversation") {
                  const first = msgs.find((m) => m.role === "user")?.content ?? "";
                  title = (await utilityCompletion(`Write a short conversation title (max 6 words, no quotes, no punctuation at the end) for this message:\n\n${first.slice(0, 1200)}`).catch(() => "")).replace(/^["'\s]+|["'.\s]+$/g, "").slice(0, 80) || first.slice(0, 48);
                  await supabase.from("conversations").update({ title }).eq("id", convo.id);
                }
                send(c, { type: "done", id, title });
              } catch (e) {
                if (request.signal.aborted) await persist("stopped");
                else { console.error(e); await persist("error"); await log("error", { actual_model_id: profile.modelId, detail: "stream interrupted" }); send(c, { type: "error", error: "The response was interrupted. Please try again." }); }
              } finally {
                done();
                try { c.close(); } catch { /* closed */ }
              }
            },
          });
          return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" } });
        } catch (e) {
          release?.();
          if (e instanceof z.ZodError) return Response.json({ error: "That request wasn’t valid.", code: "invalid" }, { status: 400 });
          if (request.signal.aborted) return new Response(null, { status: 499 });
          return errorResponse(e);
        }
      },
    },
  },
});
