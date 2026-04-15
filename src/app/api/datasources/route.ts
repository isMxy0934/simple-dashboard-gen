import {
  createDatasource,
  listManagementDatasources,
} from "../../../server/datasource/datasource-admin-service";
import { parseCreateDatasourceRequest } from "../../../server/datasource/datasource-create-request";

export async function GET(): Promise<Response> {
  try {
    const data = await listManagementDatasources();
    return Response.json({
      status_code: 200,
      reason: "OK",
      data,
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "DATASOURCE_LIST_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { status_code: 400, reason: "INVALID_PAYLOAD", data: null },
      { status: 400 },
    );
  }

  try {
    const parsed = parseCreateDatasourceRequest(payload);
    const created = await createDatasource(parsed);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: created,
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 400,
        reason: error instanceof Error ? error.message : "DATASOURCE_CREATE_FAILED",
        data: null,
      },
      { status: 400 },
    );
  }
}
