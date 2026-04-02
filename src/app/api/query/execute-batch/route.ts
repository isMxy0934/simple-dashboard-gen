import { handleExecuteBatchRoute } from "../../../../server/runtime/query-service";

export async function POST(request: Request): Promise<Response> {
  return handleExecuteBatchRoute(request);
}
