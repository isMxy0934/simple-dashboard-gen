import type { RendererValidationCheck } from "@/renderers/core/validation-result";
import { summarizeRendererValidationChecks } from "@/renderers/core/validation-result";
import {
  listAuthoringChecks,
  saveAuthoringChecks,
} from "@/server/authoring/checks-repository";
import { DEFAULT_WORKSPACE_ID } from "@/shared/workspace-defaults";

interface BrowserRendererCheckUpdate {
  view_id: string;
  browser_check: RendererValidationCheck;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRendererValidationCheck(value: unknown): value is RendererValidationCheck {
  return (
    isRecord(value) &&
    (value.target === "browser" || value.target === "server") &&
    (value.status === "ok" ||
      value.status === "warning" ||
      value.status === "error" ||
      value.status === "unknown") &&
    typeof value.reason === "string"
  );
}

function parseBrowserCheckUpdates(input: unknown): {
  workspaceId: string;
  dashboardId: string;
  sessionId: string;
  checks: BrowserRendererCheckUpdate[];
} | null {
  if (
    !isRecord(input) ||
    typeof input.dashboardId !== "string" ||
    typeof input.sessionId !== "string" ||
    !Array.isArray(input.checks)
  ) {
    return null;
  }

  const checks = input.checks
    .filter(
      (entry): entry is { view_id: string; browser_check: RendererValidationCheck } =>
        isRecord(entry) &&
        typeof entry.view_id === "string" &&
        isRendererValidationCheck(entry.browser_check),
    )
    .map((entry) => ({
      view_id: entry.view_id,
      browser_check: entry.browser_check,
    }));

  return {
    workspaceId:
      typeof input.workspaceId === "string"
        ? input.workspaceId
        : DEFAULT_WORKSPACE_ID,
    dashboardId: input.dashboardId,
    sessionId: input.sessionId,
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

  const parsed = parseBrowserCheckUpdates(payload);
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

  const existingChecks = await listAuthoringChecks(
    parsed.dashboardId,
    parsed.sessionId,
    parsed.workspaceId,
  ).catch(() => []);
  const existingByViewId = new Map(existingChecks.map((check) => [check.view_id, check]));
  const nextChecks = parsed.checks.map((update) => {
    const existing = existingByViewId.get(update.view_id);
    const mergedRendererChecks = {
      ...(existing?.renderer_checks ?? {}),
      browser: update.browser_check,
    };
    const summary = summarizeRendererValidationChecks(mergedRendererChecks);

    return {
      view_id: update.view_id,
      status:
        summary.status === "error"
          ? "error"
          : summary.status === "warning"
            ? "stale"
            : existing?.status ?? "ok",
      reason: summary.reason,
      last_checked_at: new Date().toISOString(),
      query_ids: existing?.query_ids ?? [],
      binding_ids: existing?.binding_ids ?? [],
      runtime_summary: existing?.runtime_summary,
      renderer_checks: mergedRendererChecks,
    };
  });

  if (nextChecks.length > 0) {
    await saveAuthoringChecks({
      workspaceId: parsed.workspaceId,
      dashboardId: parsed.dashboardId,
      sessionId: parsed.sessionId,
      checks: nextChecks,
    });
  }

  return Response.json({
    status_code: 200,
    reason: "OK",
    data: {
      saved: nextChecks.length,
    },
  });
}
