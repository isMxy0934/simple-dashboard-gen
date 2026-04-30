import { handleAuthoringChatStreamRoute } from "@/server/authoring/stream-service";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  return handleAuthoringChatStreamRoute(id);
}
