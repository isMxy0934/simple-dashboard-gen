import { handleDatasourceContextRoute } from "../../../../server/datasource/context-service";

export async function GET(): Promise<Response> {
  return handleDatasourceContextRoute();
}
