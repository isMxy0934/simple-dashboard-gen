import { randomUUID } from "crypto";
import { appendAuthoringAgentTaskEvent, getAuthoringAgentTask } from "./task-repository";
import {
  buildEmptyAuthoringTaskState,
  type AuthoringTaskEvent,
  type AuthoringTaskInterventionState,
  type AuthoringTaskRuntimeStatus,
  type AuthoringTaskStatus,
} from "../../ai/runtime/authoring-task-state";

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
): value is Omit<AuthoringTaskEvent, "id" | "createdAt"> & {
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
): value is AuthoringTaskInterventionState | null {
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
  status?: AuthoringTaskStatus;
  summary?: string;
  currentGoal?: string;
  pendingApproval?: boolean;
  runtimeStatus?: AuthoringTaskRuntimeStatus;
  intervention?: AuthoringTaskInterventionState | null;
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
  const sessionKey = new URL(request.url).searchParams.get("sessionKey");
  if (!sessionKey) {
    return Response.json(
      {
        status_code: 400,
        reason: "MISSING_SESSION_KEY",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const payload = await getAuthoringAgentTask(sessionKey);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        sessionKey,
        payload:
          payload ??
          buildEmptyAuthoringTaskState({
            sessionKey,
            updatedAt: new Date(0).toISOString(),
          }),
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "AUTHORING_TASK_LOAD_FAILED",
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
    typeof payload.sessionKey !== "string" ||
    !isTaskEventInput(payload.event) ||
    (payload.patch !== undefined && !isTaskPatch(payload.patch))
  ) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_AUTHORING_TASK_EVENT",
        data: null,
      },
      { status: 400 },
    );
  }

  const createdAt = payload.event.createdAt ?? new Date().toISOString();
  const saved = await appendAuthoringAgentTaskEvent({
    sessionKey: payload.sessionKey,
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
