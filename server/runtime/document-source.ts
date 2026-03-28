import type { DashboardDocument, ExecuteBatchRequest } from "../../contracts";
import { getDashboardSnapshot } from "../dashboards/repository";

export async function resolveExecuteBatchDocument(
  request: ExecuteBatchRequest,
): Promise<DashboardDocument | null> {
  const snapshot = await getDashboardSnapshot(request.dashboard_id, "viewer");
  if (!snapshot || snapshot.version !== request.version) {
    return null;
  }

  return snapshot.document;
}
