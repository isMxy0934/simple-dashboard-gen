import {
  handleAgentTaskGetRoute,
  handleAgentTaskPostRoute,
} from "../../../../server/agent/task-service";

export async function GET(request: Request): Promise<Response> {
  return handleAgentTaskGetRoute(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleAgentTaskPostRoute(request);
}
