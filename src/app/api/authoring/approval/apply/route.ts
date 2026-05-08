import { applyApprovedAuthoringPatch } from "@/server/authoring/approval-service";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";
import type { DashboardDocument } from "@/contracts";
import { serviceResultToApiResponse } from "@/server/service-result";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardDocumentLike(value: unknown): value is DashboardDocument {
  return (
    isRecord(value) &&
    isRecord(value.dashboard_spec) &&
    Array.isArray(value.query_defs) &&
    Array.isArray(value.bindings)
  );
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

  if (
    !isRecord(payload) ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.sessionId !== "string" ||
    typeof payload.dashboardId !== "string" ||
    typeof payload.proposalId !== "string" ||
    payload.proposalId.trim().length === 0 ||
    typeof payload.baseVersion !== "number" ||
    !Number.isInteger(payload.baseVersion) ||
    payload.baseVersion < 0 ||
    typeof payload.currentDocumentHash !== "string" ||
    payload.currentDocumentHash.trim().length === 0 ||
    (payload.focusedViewId !== undefined &&
      payload.focusedViewId !== null &&
      typeof payload.focusedViewId !== "string") ||
    !isDashboardDocumentLike(payload.dashboard)
  ) {
    return Response.json(
      { status_code: 400, reason: "INVALID_APPROVAL_APPLY_REQUEST", data: null },
      { status: 400 },
    );
  }

  try {
    const result = await applyApprovedAuthoringPatch({
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      sessionId: payload.sessionId,
      chatSessionId: buildAuthoringCompositeSessionId({
        workspaceId: payload.workspaceId,
        userId: payload.userId,
        dashboardId: payload.dashboardId,
        sessionId: payload.sessionId,
      }),
      dashboardId: payload.dashboardId,
      focusedViewId:
        typeof payload.focusedViewId === "string" ? payload.focusedViewId : null,
      dashboard: payload.dashboard,
      proposalId: payload.proposalId.trim(),
      baseVersion: payload.baseVersion,
      currentDocumentHash: payload.currentDocumentHash.trim(),
    });

    if (result.ok) {
      return Response.json({
        status_code: 200,
        reason: "OK",
        data: result.data.output,
      });
    }
    return serviceResultToApiResponse(result);
  } catch (error) {
    return Response.json(
      {
        status_code: 409,
        reason:
          error instanceof Error
            ? error.message
            : "AUTHORING_APPROVAL_APPLY_FAILED",
        data: null,
      },
      { status: 409 },
    );
  }
}
