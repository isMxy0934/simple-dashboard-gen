import { createUIMessageStreamResponse } from "ai";
import { getMainAgentActiveStream } from "@/server/main-agent/active-streams";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";

export async function handleAgentChatStreamRoute(
  sessionId: string,
): Promise<Response> {
  const stream = getMainAgentActiveStream(sessionId);

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
