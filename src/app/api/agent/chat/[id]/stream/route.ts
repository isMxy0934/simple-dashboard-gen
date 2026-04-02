import { handleAgentChatStreamRoute } from "../../../../../../server/agent/stream-service";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
): Promise<Response> {
  const { id } = await context.params;
  return handleAgentChatStreamRoute(id);
}
