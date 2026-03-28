import { createUIMessageStreamResponse } from "ai";
import { getAuthoringAgentActiveStream } from "./active-streams";
import { writeDebugLog } from "../logging/debug-log";

export async function handleAgentChatStreamRoute(
  sessionKey: string,
): Promise<Response> {
  const stream = getAuthoringAgentActiveStream(sessionKey);

  if (!stream) {
    return new Response(null, {
      status: 204,
    });
  }

  await writeDebugLog("agent-chat", "resume-stream-hit", {
    chat_id: sessionKey,
  });

  return createUIMessageStreamResponse({
    stream,
  });
}
