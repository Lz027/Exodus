import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { errorResponse, groqFetch, requireUser, resolveProfile, utilityCompletion } from "@/lib/ai/groq.server";
import { PROVIDER, profiles, type ProfileKey } from "@/lib/ai/registry";
import { systemPrompts } from "@/lib/ai/prompts";

const Body = z.object({
  conversationId: z.string().uuid(),
  profile: z.enum(["kimi", "general", "fast", "deep", "reasoning", "vision"]),
  images: z.array(z.string().startsWith("data:image/").max(7_000_000)).max(4).optional(),
});

type GroqMsg = { role: "system" | "user" | "assistant"; content: string | unknown[] };

export const Route = createFileRoute("/api/ai/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { supabase, userId } = await requireUser(request);
          const body = Body.parse(await request.json());
          const { data: convo } = await supabase.from("conversations").select("*").eq("id", body.conversationId).maybeSingle();
          if (!convo) return Response.json({ error: "This conversation no longer exists." }, { status: 404 });
          const { data: history } = await supabase.from("messages").select("role,content,status").eq("conversation_id", convo.id).order("created_at", { ascending: false }).limit(30);
          const msgs = (history ?? []).reverse().filter((m) => m.content.trim());
          if (!msgs.length || msgs[msgs.length - 1]!.role !== "user") return Response.json({ error: "There’s no message to answer yet." }, { status: 400 });

          const hasImages = !!body.images?.length;
          const requested: ProfileKey = hasImages ? "vision" : body.profile;
          const { profile, fallbackUsed } = await resolveProfile(requested);
          const visionLost = hasImages && profile.key !== "vision";
          let notice = fallbackUsed ? `${profiles[requested].label} is unavailable right now. Exodus is using ${profile.label} for this response.` : "";
          if (visionLost) notice = `Vision is unavailable right now, so Exodus can’t look at the image. ${profile.label} is answering from your text only.`;

          let context = "";
          if (convo.project_id) {
            const [{ data: project }, { data: memory }] = await Promise.all([
              supabase.from("projects").select("name,description,status,starting_stack").eq("id", convo.project_id).maybeSingle(),
              supabase.from("project_memory").select("content").eq("project_id", convo.project_id).eq("pinned", true).limit(12),
            ]);
            if (project) context += `\n\nActive project: ${project.name} (${project.status}). ${project.description} Stack: ${project.starting_stack || "not chosen"}.`;
            if (memory?.length) context += `\nPinned project memory:\n${memory.map((m) => `- ${m.content}`).join("\n")}`;
          }
          const system = (profile.key === "vision" ? systemPrompts.vision : convo.workspace_type === "coding" ? systemPrompts.coding : systemPrompts.general) + context;
          const messages: GroqMsg[] = [{ role: "system", content: system }, ...msgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))];
          if (hasImages && profile.key === "vision") {
            const last = messages[messages.length - 1]!;
            last.content = [{ type: "text", text: String(last.content) }, ...body.images!.map((url) => ({ type: "image_url", image_url: { url } }))];
          }

          const isOss = profile.modelId.startsWith("openai/gpt-oss");
          const upstream = await groqFetch("/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: request.signal,
            body: JSON.stringify({ model: profile.modelId, messages, stream: true, ...(isOss ? { include_reasoning: false, reasoning_effort: profile.key === "deep" ? "medium" : "low" } : { temperature: 0.6 }) }),
          });

          const enc = new TextEncoder();
          const send = (c: ReadableStreamDefaultController, e: object) => c.enqueue(enc.encode(JSON.stringify(e) + "\n"));
          let full = "";
          const persist = async (status: "completed" | "stopped" | "error") => {
            if (!full.trim() && status !== "completed") return null;
            const { data } = await supabase.from("messages").insert({ conversation_id: convo.id, user_id: userId, role: "assistant", content: full, model: profile.modelId, model_label: profile.label, provider: PROVIDER, capability: profile.capability, fallback_used: fallbackUsed || visionLost, status }).select("id").single();
            await supabase.from("conversations").update({ updated_at: new Date().toISOString(), model_profile: body.profile }).eq("id", convo.id);
            return data?.id ?? null;
          };

          const stream = new ReadableStream({
            async start(c) {
              send(c, { type: "meta", label: profile.label, profile: profile.key, fallbackUsed: fallbackUsed || visionLost, notice });
              const reader = upstream.body!.getReader();
              const dec = new TextDecoder();
              let buf = "";
              try {
                for (;;) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  buf += dec.decode(value, { stream: true });
                  const lines = buf.split("\n");
                  buf = lines.pop() ?? "";
                  for (const line of lines) {
                    const t = line.trim();
                    if (!t.startsWith("data:")) continue;
                    const payload = t.slice(5).trim();
                    if (payload === "[DONE]") continue;
                    try {
                      const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
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
                if (request.signal.aborted) { await persist("stopped"); }
                else { console.error(e); await persist("error"); try { send(c, { type: "error", error: "The response was interrupted. Please try again." }); } catch { /* closed */ } }
              } finally {
                try { c.close(); } catch { /* closed */ }
              }
            },
          });
          return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" } });
        } catch (e) {
          if (e instanceof z.ZodError) return Response.json({ error: "That request wasn’t valid." }, { status: 400 });
          return errorResponse(e);
        }
      },
    },
  },
});
