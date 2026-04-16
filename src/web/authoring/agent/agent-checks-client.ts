import type { RendererChecksByView } from "@/renderers/core/validation-result";

export async function persistAuthoringRendererChecks(input: {
  workspaceId?: string;
  dashboardId: string;
  sessionId: string;
  rendererChecks: RendererChecksByView;
}): Promise<void> {
  const checks = Object.entries(input.rendererChecks)
    .filter(([, rendererChecks]) => rendererChecks.browser)
    .map(([view_id, rendererChecks]) => ({
      view_id,
      browser_check: rendererChecks.browser,
    }));

  if (checks.length === 0) {
    return;
  }

  const response = await fetch("/api/view-worker/checks", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId ?? "ws_default",
      dashboardId: input.dashboardId,
      sessionId: input.sessionId,
      checks,
    }),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
  };

  if (!response.ok || payload.status_code !== 200) {
    throw new Error(payload.reason || "Unable to persist renderer checks.");
  }
}
