import type {
  AuthoringTaskEvent,
  AuthoringTaskInterventionState,
  PersistedAuthoringTaskPayload,
} from "../../../ai/runtime/authoring-task-state";

export async function loadAuthoringTask(
  sessionKey: string,
): Promise<PersistedAuthoringTaskPayload | null> {
  const response = await fetch(
    `/api/agent/task?sessionKey=${encodeURIComponent(sessionKey)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      sessionKey: string;
      payload: PersistedAuthoringTaskPayload;
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data?.payload) {
    throw new Error(payload.reason || "Unable to load authoring task.");
  }

  return payload.data.payload;
}

export async function reportAuthoringTaskEvent(input: {
  sessionKey: string;
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
}): Promise<PersistedAuthoringTaskPayload> {
  const response = await fetch("/api/agent/task", {
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
      payload: PersistedAuthoringTaskPayload;
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data?.payload) {
    throw new Error(payload.reason || "Unable to report authoring task event.");
  }

  return payload.data.payload;
}
