import { handleAgentChecksPutRoute } from "@/server/authoring/checks-service";

export async function PUT(request: Request): Promise<Response> {
  return handleAgentChecksPutRoute(request);
}
