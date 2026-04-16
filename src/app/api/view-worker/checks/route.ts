import { handleAgentChecksPutRoute } from "@/server/main-agent/checks-service";

export async function PUT(request: Request): Promise<Response> {
  return handleAgentChecksPutRoute(request);
}
