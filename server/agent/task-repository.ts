import "server-only";

import type { QueryResultRow } from "pg";
import {
  buildEmptyAuthoringTaskState,
  sanitizePersistedAuthoringTaskPayload,
  type AuthoringTaskEvent,
  type PersistedAuthoringTaskPayload,
} from "../../ai/runtime/authoring-task-state";
import { getPgPool } from "../datasource/postgres";

declare global {
  var __authoringAgentTaskTableReady: Promise<void> | undefined;
}

interface AuthoringAgentTaskRow extends QueryResultRow {
  session_key: string;
  payload: PersistedAuthoringTaskPayload;
  updated_at: string | Date;
}

export async function getAuthoringAgentTask(
  sessionKey: string,
): Promise<PersistedAuthoringTaskPayload | null> {
  await ensureAuthoringAgentTasksTable();

  const pool = getPgPool();
  const result = await pool.query<AuthoringAgentTaskRow>(
    `
      select session_key, payload, updated_at
      from authoring_agent_tasks
      where session_key = $1
      limit 1
    `,
    [sessionKey],
  );

  const row = result.rows[0];
  return row ? sanitizePersistedAuthoringTaskPayload(row.payload) : null;
}

export async function saveAuthoringAgentTask(input: {
  sessionKey: string;
  payload: PersistedAuthoringTaskPayload;
}) {
  await ensureAuthoringAgentTasksTable();

  const pool = getPgPool();
  const payload = sanitizePersistedAuthoringTaskPayload(input.payload);
  const result = await pool.query<{ updated_at: string | Date }>(
    `
      insert into authoring_agent_tasks (session_key, payload)
      values ($1, $2::jsonb)
      on conflict (session_key)
      do update set payload = excluded.payload, updated_at = now()
      returning updated_at
    `,
    [input.sessionKey, JSON.stringify(payload)],
  );

  return {
    session_key: input.sessionKey,
    updated_at: new Date(result.rows[0].updated_at).toISOString(),
    payload,
  };
}

export async function syncAuthoringAgentTaskSnapshot(input: {
  sessionKey: string;
  snapshot: Omit<
    PersistedAuthoringTaskPayload,
    "version" | "events" | "intervention"
  >;
  dashboardName?: string;
}) {
  const current =
    (await getAuthoringAgentTask(input.sessionKey)) ??
    buildEmptyAuthoringTaskState({
      sessionKey: input.sessionKey,
      dashboardId: input.snapshot.dashboardId,
      dashboardName: input.dashboardName ?? input.snapshot.dashboardName,
      updatedAt: input.snapshot.updatedAt,
    });

  return saveAuthoringAgentTask({
    sessionKey: input.sessionKey,
    payload: {
      ...current,
      dashboardId: input.snapshot.dashboardId,
      dashboardName: input.snapshot.dashboardName,
      status: current.intervention?.active ? "intervention" : input.snapshot.status,
      route: input.snapshot.route,
      activeStage: input.snapshot.activeStage,
      summary: input.snapshot.summary,
      currentGoal: input.snapshot.currentGoal,
      activeTools: [...input.snapshot.activeTools],
      activeSkills: [...input.snapshot.activeSkills],
      pendingApproval: input.snapshot.pendingApproval,
      runtimeStatus: input.snapshot.runtimeStatus,
      updatedAt: input.snapshot.updatedAt,
    },
  });
}

export async function appendAuthoringAgentTaskEvent(input: {
  sessionKey: string;
  event: AuthoringTaskEvent;
  patch?: Partial<
    Omit<PersistedAuthoringTaskPayload, "version" | "sessionKey" | "events">
  >;
}) {
  const current =
    (await getAuthoringAgentTask(input.sessionKey)) ??
    buildEmptyAuthoringTaskState({
      sessionKey: input.sessionKey,
      dashboardId: input.patch?.dashboardId ?? null,
      dashboardName: input.patch?.dashboardName ?? "Untitled Dashboard",
      updatedAt: input.event.createdAt,
    });

  const hasDuplicateDedupeKey =
    input.event.dedupeKey &&
    current.events.some((event) => event.dedupeKey === input.event.dedupeKey);

  const nextEvents = hasDuplicateDedupeKey
    ? current.events
    : [...current.events, input.event].slice(-40);
  const nextPayload: PersistedAuthoringTaskPayload = sanitizePersistedAuthoringTaskPayload({
    ...current,
    ...input.patch,
    sessionKey: input.sessionKey,
    dashboardId: input.patch?.dashboardId ?? current.dashboardId,
    dashboardName: input.patch?.dashboardName ?? current.dashboardName,
    events: nextEvents,
    updatedAt: input.patch?.updatedAt ?? input.event.createdAt,
  });

  return saveAuthoringAgentTask({
    sessionKey: input.sessionKey,
    payload: nextPayload,
  });
}

async function ensureAuthoringAgentTasksTable() {
  if (!globalThis.__authoringAgentTaskTableReady) {
    globalThis.__authoringAgentTaskTableReady = createAuthoringAgentTasksTable();
  }

  await globalThis.__authoringAgentTaskTableReady;
}

async function createAuthoringAgentTasksTable() {
  const pool = getPgPool();
  await pool.query(`
    create table if not exists authoring_agent_tasks (
      session_key text primary key,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}
