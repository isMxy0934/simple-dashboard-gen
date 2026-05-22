import { getAuthoringActiveStream } from "@/server/authoring/active-streams";
import { emitAuthoringTraceEvent } from "@/server/logs/authoring-trace";

export async function handleAuthoringChatStreamRoute(
  sessionId: string,
  requestId?: string | null,
): Promise<Response> {
  const stream = getAuthoringActiveStream(sessionId);

  if (!stream) {
    return new Response(null, {
      status: 204,
    });
  }

  await emitAuthoringTraceEvent({
    sessionId,
    requestId,
    scope: "authoring-chat",
    event: "resume_stream_hit",
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
