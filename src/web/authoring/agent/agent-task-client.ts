import type {
  AuthoringTaskEvent,
  AuthoringTaskInterventionState,
  AuthoringTaskPayload,
} from "@/ai/authoring/contracts/task-event";

export async function loadAuthoringTask(
  input: {
    workspaceId: string;
    userId: string;
    dashboardId: string;
    chatSessionId: string;
  },
): Promise<AuthoringTaskPayload | null> {
  const response = await fetch(
    `/api/authoring/task?dashboardId=${encodeURIComponent(input.dashboardId)}&chatSessionId=${encodeURIComponent(input.chatSessionId)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      sessionId: string;
      payload: AuthoringTaskPayload;
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data?.payload) {
    throw new Error(payload.reason || "Unable to load authoring task.");
  }

  return payload.data.payload;
}

export async function reportAuthoringTaskEvent(input: {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  chatSessionId: string;
  event: Omit<AuthoringTaskEvent, "id" | "createdAt"> & {
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
    intervention?: AuthoringTaskInterventionState | null;
    updatedAt?: string;
  };
}): Promise<AuthoringTaskPayload> {
  const response = await fetch("/api/authoring/task", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      dashboardId: input.dashboardId,
      chatSessionId: input.chatSessionId,
      event: input.event,
      ...(input.patch ? { patch: input.patch } : {}),
    }),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      payload: AuthoringTaskPayload;
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data?.payload) {
    throw new Error(payload.reason || "Unable to report authoring task event.");
  }

  return payload.data.payload;
}
