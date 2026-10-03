import { createFileRoute } from "@tanstack/react-router";
import { errorResponse, groqFetch, PublicError, requireUser } from "@/lib/ai/groq.server";
import { audio } from "@/lib/ai/registry";

export const Route = createFileRoute("/api/ai/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const form = await request.formData();
          const file = form.get("audio");
          if (!(file instanceof Blob) || file.size === 0) throw new PublicError("No audio was recorded.", 400);
          if (file.size > 20 * 1024 * 1024) throw new PublicError("That recording is too long.", 400);
          const out = new FormData();
          out.append("file", file, "voice.webm");
          out.append("model", audio.transcribe.modelId);
          out.append("response_format", "json");
          const res = await groqFetch("/audio/transcriptions", { method: "POST", body: out });
          const json = (await res.json()) as { text?: string };
          return Response.json({ text: (json.text ?? "").trim() });
        } catch (e) {
          return errorResponse(e);
        }
      },
    },
  },
});
