import type { ViewCheckSnapshot } from "@/ai/authoring/contracts/tool-io";
import { saveAuthoringChecks } from "@/server/authoring/checks-repository";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";

interface ParsedCheckSnapshots {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
  checks: ViewCheckSnapshot[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isViewCheckSnapshot(value: unknown): value is ViewCheckSnapshot {
  return (
    isRecord(value) &&
    isNonEmptyString(value.view_id) &&
    (value.status === "unknown" ||
      value.status === "ok" ||
      value.status === "empty" ||
      value.status === "error" ||
      value.status === "stale") &&
    typeof value.reason === "string" &&
    isStringArray(value.query_ids) &&
    isStringArray(value.binding_ids) &&
    (value.last_checked_at === undefined ||
      typeof value.last_checked_at === "string") &&
    (value.document_hash === undefined ||
      typeof value.document_hash === "string") &&
    (value.dashboard_version === undefined ||
      (typeof value.dashboard_version === "number" &&
        Number.isInteger(value.dashboard_version) &&
        value.dashboard_version >= 0)) &&
    (value.source === undefined ||
      value.source === "server" ||
      value.source === "browser") &&
    (value.runtime_summary === undefined || isRecord(value.runtime_summary)) &&
    (value.renderer_checks === undefined || isRecord(value.renderer_checks))
  );
}

function parseFullCheckSnapshots(input: unknown): ParsedCheckSnapshots | null {
  if (
    !isRecord(input) ||
    !isNonEmptyString(input.workspaceId) ||
    !isNonEmptyString(input.userId) ||
    !isNonEmptyString(input.dashboardId) ||
    !isNonEmptyString(input.chatSessionId) ||
    "sessionId" in input
  ) {
    return null;
  }

  const rawChecks = Array.isArray(input.snapshots) ? input.snapshots : null;
  if (!rawChecks) {
    return null;
  }

  const checks = rawChecks.filter(isViewCheckSnapshot);
  if (checks.length !== rawChecks.length) {
    return null;
  }

  return {
    workspaceId: input.workspaceId.trim(),
    userId: input.userId.trim(),
    dashboardId: input.dashboardId.trim(),
    sessionId: buildAuthoringCompositeSessionId({
      workspaceId: input.workspaceId.trim(),
      userId: input.userId.trim(),
      dashboardId: input.dashboardId.trim(),
      sessionId: input.chatSessionId.trim(),
    }),
    checks,
  };
}

export async function handleAuthoringChecksPutRoute(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_PAYLOAD",
        data: null,
      },
      { status: 400 },
    );
  }

  const parsed = parseFullCheckSnapshots(payload);
  if (!parsed) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_PAYLOAD",
        data: null,
      },
      { status: 400 },
    );
  }

  if (parsed.checks.length > 0) {
    await saveAuthoringChecks({
      workspaceId: parsed.workspaceId,
      dashboardId: parsed.dashboardId,
      sessionId: parsed.sessionId,
      checks: parsed.checks,
    });
  }

  return Response.json({
    status_code: 200,
    reason: "OK",
    data: {
      saved: parsed.checks.length,
    },
  });
}
