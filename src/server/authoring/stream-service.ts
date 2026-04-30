import { getAuthoringActiveStream } from "@/server/authoring/active-streams";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";

export async function handleAuthoringChatStreamRoute(
  sessionId: string,
): Promise<Response> {
  const stream = getAuthoringActiveStream(sessionId);

  if (!stream) {
    return new Response(null, {
      status: 204,
    });
  }

  await writeSessionTraceEvent({
    sessionId,
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
