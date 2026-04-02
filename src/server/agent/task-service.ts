import { randomUUID } from "crypto";
import {
  appendDashboardAgentTaskEvent,
  getDashboardAgentTask,
} from "@/server/agent/task-repository";
import {
  buildEmptyDashboardAgentTaskState,
  type DashboardAgentTaskEvent,
  type DashboardAgentTaskInterventionState,
  type DashboardAgentTaskRuntimeStatus,
  type DashboardAgentTaskStatus,
} from "@/ai/dashboard-agent/contracts/task-state";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function isTaskEventMetadata(
  value: unknown,
): value is Record<string, string | number | boolean | null> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((item) =>
    item === null ||
    typeof item === "string" ||
    typeof item === "number" ||
    typeof item === "boolean",
  );
}

function isTaskEventInput(
  value: unknown,
): value is Omit<DashboardAgentTaskEvent, "id" | "createdAt"> & {
  createdAt?: string;
} {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    typeof value.title === "string" &&
    typeof value.detail === "string" &&
    isNullableString(value.dedupeKey) &&
    (value.createdAt === undefined || typeof value.createdAt === "string") &&
    (value.metadata === undefined || isTaskEventMetadata(value.metadata))
  );
}

function isInterventionState(
  value: unknown,
): value is DashboardAgentTaskInterventionState | null {
  return (
    value === null ||
    (isRecord(value) &&
      (value.kind === "layout" || value.kind === "contract") &&
      typeof value.active === "boolean" &&
      isNullableString(value.viewId) &&
      isNullableString(value.viewTitle) &&
      typeof value.updatedAt === "string")
  );
}

function isTaskPatch(
  value: unknown,
): value is {
  dashboardId?: string | null;
  dashboardName?: string;
  status?: DashboardAgentTaskStatus;
  summary?: string;
  currentGoal?: string;
  pendingApproval?: boolean;
  runtimeStatus?: DashboardAgentTaskRuntimeStatus;
  intervention?: DashboardAgentTaskInterventionState | null;
  updatedAt?: string;
} {
  return (
    isRecord(value) &&
    isNullableString(value.dashboardId) &&
    (value.dashboardName === undefined || typeof value.dashboardName === "string") &&
    (value.status === undefined ||
      value.status === "idle" ||
      value.status === "authoring" ||
      value.status === "awaiting_approval" ||
      value.status === "repairing" ||
      value.status === "reviewing" ||
      value.status === "intervention" ||
      value.status === "published") &&
    (value.summary === undefined || typeof value.summary === "string") &&
    (value.currentGoal === undefined || typeof value.currentGoal === "string") &&
    (value.pendingApproval === undefined || typeof value.pendingApproval === "boolean") &&
    (value.runtimeStatus === undefined ||
      value.runtimeStatus === "idle" ||
      value.runtimeStatus === "loading" ||
      value.runtimeStatus === "ok" ||
      value.runtimeStatus === "warning" ||
      value.runtimeStatus === "error") &&
    (value.intervention === undefined || isInterventionState(value.intervention)) &&
    (value.updatedAt === undefined || typeof value.updatedAt === "string")
  );
}

export async function handleAgentTaskGetRoute(request: Request): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json(
      {
        status_code: 400,
        reason: "MISSING_SESSION_ID",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const payload = await getDashboardAgentTask(sessionId);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        sessionId,
        payload:
          payload ??
          buildEmptyDashboardAgentTaskState({
            sessionId,
            updatedAt: new Date(0).toISOString(),
          }),
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "DASHBOARD_AGENT_TASK_LOAD_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}

export async function handleAgentTaskPostRoute(request: Request): Promise<Response> {
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

  if (
    !isRecord(payload) ||
    typeof payload.sessionId !== "string" ||
    !isTaskEventInput(payload.event) ||
    (payload.patch !== undefined && !isTaskPatch(payload.patch))
  ) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_DASHBOARD_AGENT_TASK_EVENT",
        data: null,
      },
      { status: 400 },
    );
  }

  const createdAt = payload.event.createdAt ?? new Date().toISOString();
  const saved = await appendDashboardAgentTaskEvent({
    sessionId: payload.sessionId,
    event: {
      id: `task-event-${randomUUID()}`,
      kind: payload.event.kind,
      title: payload.event.title,
      detail: payload.event.detail,
      createdAt,
      dedupeKey: payload.event.dedupeKey ?? undefined,
      metadata: payload.event.metadata,
    },
    patch: payload.patch
      ? {
          ...payload.patch,
          updatedAt: payload.patch.updatedAt ?? createdAt,
        }
      : undefined,
  });

  return Response.json({
    status_code: 200,
    reason: "OK",
    data: saved,
  });
}
