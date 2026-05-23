import {
  createDatasource,
  DatasourceConnectionTestError,
  listManagementDatasourcesForWorkspace,
} from "../../../server/datasource/datasource-admin-service";
import {
  parseCreateDatasourceRequest,
  ParseCreateDatasourceRequestError,
} from "../../../server/datasource/datasource-create-request";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireApiSession(
      request,
      Permission.DatasourceRead,
      { skipCsrf: true },
    );
    const data = await listManagementDatasourcesForWorkspace(session.workspaceId);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiErrorToResponse(error);
    }
    return Response.json(
      { status_code: 503, reason: "DATASOURCE_LIST_FAILED", data: null },
      { status: 503 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireApiSession(request, Permission.DatasourceManage);
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

    const created = await createDatasource({
      ...parsed,
      workspaceId: session.workspaceId,
    });
    return Response.json({ status_code: 200, reason: "OK", data: created });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiErrorToResponse(error);
    }
    if (error instanceof DatasourceConnectionTestError) {
      return Response.json(
        {
          status_code: 422,
          reason: "CONNECTION_TEST_FAILED",
          data: { diagnostic: error.diagnostic },
        },
        { status: 422 },
      );
    }
    console.error("[POST /api/datasources] createDatasource failed:", error);
    return Response.json(
      { status_code: 500, reason: "DATASOURCE_SAVE_FAILED", data: null },
      { status: 500 },
    );
  }
}
