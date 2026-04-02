import { createUIMessageStreamResponse } from "ai";
import { getDashboardAgentActiveStream } from "@/server/agent/active-streams";
import { writeSessionTraceEvent } from "@/server/trace/trace-writer";

export async function handleAgentChatStreamRoute(
  sessionId: string,
): Promise<Response> {
  const stream = getDashboardAgentActiveStream(sessionId);

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
