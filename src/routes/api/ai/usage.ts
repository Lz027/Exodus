import { createFileRoute } from "@tanstack/react-router";
import { availability, errorResponse, requireUser } from "@/lib/ai/groq.server";
import { PROVIDER } from "@/lib/ai/registry";

export const Route = createFileRoute("/api/ai/usage")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { supabase } = await requireUser(request);
          const since = new URL(request.url).searchParams.get("since");
          let q = supabase.from("usage_events").select("kind,input_tokens,output_tokens,created_at").order("created_at", { ascending: false }).limit(2000);
          if (since && !Number.isNaN(Date.parse(since))) q = q.gte("created_at", since);
          const [{ data }, models] = await Promise.all([q, availability()]);
          const rows = data ?? [];
          const req = rows.filter((r) => r.kind === "request");
          return Response.json({
            provider: PROVIDER,
            keyStatus: models.keyStatus,
            availability: models.availability,
            requests: req.length,
            inputTokens: req.reduce((n, r) => n + r.input_tokens, 0),
            outputTokens: req.reduce((n, r) => n + r.output_tokens, 0),
            fallbacks: rows.filter((r) => r.kind === "fallback").length,
            rateLimits: rows.filter((r) => r.kind === "rate_limit").length,
            errors: rows.filter((r) => r.kind === "error").length,
            lastRequestAt: req[0]?.created_at ?? null,
          });
        } catch (e) {
          return errorResponse(e);
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { supabase, userId } = await requireUser(request);
          await supabase.from("usage_events").delete().eq("user_id", userId);
          return Response.json({ ok: true });
        } catch (e) {
          return errorResponse(e);
        }
      },
    },
  },
});
