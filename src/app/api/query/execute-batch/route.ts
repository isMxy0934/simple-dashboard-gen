import { handleExecuteBatchRoute } from "../../../../server/execution/query-service";

export async function POST(request: Request): Promise<Response> {
  return handleExecuteBatchRoute(request);
}
