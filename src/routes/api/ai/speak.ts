import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { errorResponse, groqFetch, requireUser } from "@/lib/ai/groq.server";
import { audio } from "@/lib/ai/registry";

const Body = z.object({ text: z.string().min(1).max(20000) });

// Strip markdown so the voice reads prose, not symbols. Orpheus accepts short inputs, so cap length.
const clean = (t: string) => t.replace(/```[\s\S]*?```/g, " (code omitted) ").replace(/[#*_`>|-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);

export const Route = createFileRoute("/api/ai/speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const { text } = Body.parse(await request.json());
          const res = await groqFetch("/audio/speech", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: audio.speak.modelId, voice: audio.speak.voice, input: clean(text), response_format: "wav" }),
          });
          return new Response(res.body, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
        } catch (e) {
          if (e instanceof z.ZodError) return Response.json({ error: "Nothing to read aloud." }, { status: 400 });
          return errorResponse(e);
        }
      },
    },
  },
});
