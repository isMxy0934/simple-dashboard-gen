import type {
  DashboardAgentTaskEvent,
  DashboardAgentTaskInterventionState,
  DashboardAgentTaskPayload,
} from "@/ai/main-agent/contracts/task-state";

export async function loadAuthoringTask(
  input: {
    workspaceId: string;
    userId: string;
    dashboardId: string;
    sessionId: string;
  },
): Promise<DashboardAgentTaskPayload | null> {
  const response = await fetch(
    `/api/main-agent/task?workspaceId=${encodeURIComponent(input.workspaceId)}&userId=${encodeURIComponent(input.userId)}&dashboardId=${encodeURIComponent(input.dashboardId)}&sessionId=${encodeURIComponent(input.sessionId)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      sessionId: string;
      payload: DashboardAgentTaskPayload;
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data?.payload) {
    throw new Error(payload.reason || "Unable to load authoring task.");
  }

  return payload.data.payload;
}

export async function reportDashboardAgentTaskEvent(input: {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
  event: Omit<DashboardAgentTaskEvent, "id" | "createdAt"> & {
    createdAt?: string;
  };
  patch?: {
    dashboardId?: string | null;
    dashboardName?: string;
    status?: string;
    summary?: string;
    currentGoal?: string;
    pendingApproval?: boolean;
    runtimeStatus?: string;
    intervention?: DashboardAgentTaskInterventionState | null;
    updatedAt?: string;
  };
}): Promise<DashboardAgentTaskPayload> {
  const response = await fetch("/api/main-agent/task", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      payload: DashboardAgentTaskPayload;
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data?.payload) {
    throw new Error(payload.reason || "Unable to report authoring task event.");
  }

  return payload.data.payload;
}
