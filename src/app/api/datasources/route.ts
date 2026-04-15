import {
  createDatasource,
  listManagementDatasources,
} from "../../../server/datasource/datasource-admin-service";
import {
  parseCreateDatasourceRequest,
  ParseCreateDatasourceRequestError,
} from "../../../server/datasource/datasource-create-request";

export async function GET(): Promise<Response> {
  try {
    const data = await listManagementDatasources();
    return Response.json({
      status_code: 200,
      reason: "OK",
      data,
    });
  } catch {
    return Response.json(
      { status_code: 503, reason: "DATASOURCE_LIST_FAILED", data: null },
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

  let parsed;
  try {
    parsed = parseCreateDatasourceRequest(payload);
  } catch (error) {
    const reason =
      error instanceof ParseCreateDatasourceRequestError
        ? error.message
        : "INVALID_PAYLOAD";
    return Response.json({ status_code: 400, reason, data: null }, { status: 400 });
  }

  try {
    const created = await createDatasource(parsed);
    return Response.json({ status_code: 200, reason: "OK", data: created });
  } catch {
    return Response.json(
      { status_code: 422, reason: "CONNECTION_TEST_FAILED", data: null },
      { status: 422 },
    );
  }
}
