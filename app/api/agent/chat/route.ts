import { handleAgentChatRoute } from "../../../../server/agent/chat-service";

export { maxDuration } from "../../../../server/agent/chat-service";

export async function POST(request: Request): Promise<Response> {
  return handleAgentChatRoute(request);
}
