import { createUIMessageStreamResponse } from "ai";
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
    scope: "agent-chat",
    event: "resume_stream_hit",
  });

  return createUIMessageStreamResponse({
    stream,
  });
}
