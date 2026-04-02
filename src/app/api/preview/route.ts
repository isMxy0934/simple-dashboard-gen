import { handlePreviewRoute } from "../../../server/runtime/query-service";

export async function POST(request: Request): Promise<Response> {
  return handlePreviewRoute(request);
}
