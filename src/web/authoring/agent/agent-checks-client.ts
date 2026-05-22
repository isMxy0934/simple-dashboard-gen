import type { ViewCheckSnapshot } from "@/ai/authoring/contracts/tool-io";
import { getApiErrorMessage } from "@/web/api/api-error";

export async function persistAuthoringCheckSnapshots(input: {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  chatSessionId: string;
  checks: ViewCheckSnapshot[];
}): Promise<void> {
  if (input.checks.length === 0) {
    return;
  }

  const response = await fetch("/api/authoring/checks", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      dashboardId: input.dashboardId,
      chatSessionId: input.chatSessionId,
      snapshots: input.checks,
    }),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    details?: unknown;
    data?: unknown;
  };

  if (!response.ok || payload.status_code !== 200) {
    throw new Error(getApiErrorMessage(payload, "Unable to persist check snapshots."));
  }
}
