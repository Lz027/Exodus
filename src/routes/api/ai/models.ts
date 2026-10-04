import { createFileRoute } from "@tanstack/react-router";
import { availability, errorResponse, requireUser } from "@/lib/ai/groq.server";

export const Route = createFileRoute("/api/ai/models")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireUser(request);
          return Response.json(await availability(), { headers: { "Cache-Control": "private, max-age=30" } });
        } catch (e) {
          return errorResponse(e);
        }
      },
    },
  },
});
