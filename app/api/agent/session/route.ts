import {
  handleAgentSessionGetRoute,
  handleAgentSessionPutRoute,
} from "../../../../server/agent/session-service";

export async function GET(request: Request): Promise<Response> {
  return handleAgentSessionGetRoute(request);
}

export async function PUT(request: Request): Promise<Response> {
  return handleAgentSessionPutRoute(request);
}
