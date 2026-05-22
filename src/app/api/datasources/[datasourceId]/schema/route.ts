import {
  DatasourceSchemaLoadError,
  getDatasourceReferences,
  getDatasourceSchemaTree,
} from "../../../../../server/datasource/datasource-admin-service";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function GET(
  request: Request,
  context: { params: Promise<{ datasourceId: string }> },
): Promise<Response> {
  const { datasourceId } = await context.params;
  const mode = new URL(request.url).searchParams.get("mode");

  try {
    const session = await requireApiSession(
      request,
      Permission.DatasourceRead,
      { skipCsrf: true },
    );
    if (mode === "references") {
      const data = await getDatasourceReferences(datasourceId, session.workspaceId);
      return Response.json({ status_code: 200, reason: "OK", data });
    }

    const data = await getDatasourceSchemaTree(datasourceId, session.workspaceId);
    return Response.json({ status_code: 200, reason: "OK", data });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiErrorToResponse(error);
    }
    if (error instanceof DatasourceSchemaLoadError) {
      return Response.json(
        {
          status_code: 502,
          reason: "SCHEMA_LOAD_FAILED",
          data: { diagnostic: error.diagnostic },
        },
        { status: 502 },
      );
    }
    const isNotFound =
      error instanceof Error && error.message.toLowerCase().includes("not found");
    return Response.json(
      {
        status_code: isNotFound ? 404 : 502,
        reason: isNotFound ? "DATASOURCE_NOT_FOUND" : "SCHEMA_LOAD_FAILED",
        data: null,
      },
      { status: isNotFound ? 404 : 502 },
    );
  }
}
