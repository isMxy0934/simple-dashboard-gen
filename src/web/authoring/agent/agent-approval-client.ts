import type { ApplyPatchToolOutput } from "@/ai/authoring/contracts/tool-io";
import type { DashboardDocument } from "@/contracts";

export async function applyApprovedPatch(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
  dashboardId: string;
  focusedViewId: string | null;
  dashboard: DashboardDocument;
  proposalId: string;
  baseVersion: number;
  currentDocumentHash: string;
}): Promise<ApplyPatchToolOutput> {
  const response = await fetch("/api/authoring/approval/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: ApplyPatchToolOutput | null;
  };

  if (!response.ok || payload.status_code !== 200 || !payload.data) {
    throw new Error(payload.reason || "Unable to apply approved patch.");
  }

  return payload.data;
}
