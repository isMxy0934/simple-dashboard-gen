import {
  addCustomDatasource,
  listManagementDatasources,
} from "../../../server/datasource/datasource-admin-service";

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

  if (!payload || typeof payload !== "object") {
    return Response.json(
      { status_code: 400, reason: "INVALID_PAYLOAD", data: null },
      { status: 400 },
    );
  }

  const record = payload as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  const description =
    typeof record.description === "string" ? record.description.trim() : "";
  const postgres_url =
    typeof record.postgres_url === "string" ? record.postgres_url.trim() : "";

  if (!label || !postgres_url) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_PAYLOAD",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const created = await addCustomDatasource({
      label,
      description,
      postgres_url,
    });
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
