import type { DashboardDocument, ExecuteBatchRequest } from "../../contracts";
import { reconcileDashboardDocumentContract } from "../../domain/dashboard/document";
import { getWorkspaceDashboardSnapshot } from "../cloud/dashboard-repository";

export async function resolveExecuteBatchDocument(
  request: ExecuteBatchRequest,
): Promise<DashboardDocument | null> {
  const snapshot = await getWorkspaceDashboardSnapshot({
    workspaceId: request.workspace_id,
    dashboardId: request.dashboard_id,
    mode: "viewer",
  });
  if (!snapshot || snapshot.version !== request.version) {
    return null;
  }

  return reconcileDashboardDocumentContract(snapshot.document, {
    mobileLayoutMode: "custom",
  });
}
