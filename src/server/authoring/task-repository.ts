import "server-only";

import type { QueryResultRow } from "pg";
import {
  buildEmptyMainAgentTaskState,
  sanitizeMainAgentTaskPayload,
  type MainAgentTaskEvent,
  type MainAgentTaskPayload,
} from "@/ai/authoring/contracts/task-state";
import { getPgPool } from "@/server/datasource/postgres";

declare global {
  var __mainAgentTaskTableReady: Promise<void> | undefined;
}

interface MainAgentTaskRow extends QueryResultRow {
  session_id: string;
  dashboard_id: string | null;
  payload: MainAgentTaskPayload;
  updated_at: string | Date;
}

export async function getMainAgentTask(
  sessionId: string,
): Promise<MainAgentTaskPayload | null> {
  await ensureMainAgentTasksTable();

  const pool = getPgPool();
  const result = await pool.query<MainAgentTaskRow>(
    `
      select session_id, dashboard_id, payload, updated_at
      from main_agent_tasks
      where session_id = $1
      limit 1
    `,
    [sessionId],
  );

  const row = result.rows[0];
  return row ? sanitizeMainAgentTaskPayload(row.payload) : null;
}

export async function saveMainAgentTask(input: {
  sessionId: string;
  dashboardId?: string | null;
  payload: MainAgentTaskPayload;
}) {
  await ensureMainAgentTasksTable();

  const pool = getPgPool();
  const payload = sanitizeMainAgentTaskPayload(input.payload);
  const result = await pool.query<{ updated_at: string | Date }>(
    `
      insert into main_agent_tasks (session_id, dashboard_id, payload)
      values ($1, $2, $3::jsonb)
      on conflict (session_id)
      do update set
        dashboard_id = excluded.dashboard_id,
        payload = excluded.payload,
        updated_at = now()
      returning updated_at
    `,
    [input.sessionId, input.dashboardId ?? null, JSON.stringify(payload)],
  );

  return {
    session_id: input.sessionId,
    dashboard_id: input.dashboardId ?? null,
    updated_at: new Date(result.rows[0].updated_at).toISOString(),
    payload,
  };
}

export async function syncMainAgentTaskSnapshot(input: {
  sessionId: string;
  snapshot: Omit<
    MainAgentTaskPayload,
    "version" | "events" | "intervention"
  >;
  dashboardName?: string;
}) {
  const current =
    (await getMainAgentTask(input.sessionId)) ??
    buildEmptyMainAgentTaskState({
      sessionId: input.sessionId,
      dashboardId: input.snapshot.dashboardId,
      dashboardName: input.dashboardName ?? input.snapshot.dashboardName,
      updatedAt: input.snapshot.updatedAt,
    });

  return saveMainAgentTask({
    sessionId: input.sessionId,
    dashboardId: input.snapshot.dashboardId,
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

export async function appendMainAgentTaskEvent(input: {
  sessionId: string;
  event: MainAgentTaskEvent;
  patch?: Partial<
    Omit<MainAgentTaskPayload, "version" | "sessionId" | "events">
  >;
}) {
  const current =
    (await getMainAgentTask(input.sessionId)) ??
    buildEmptyMainAgentTaskState({
      sessionId: input.sessionId,
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
  const nextPayload: MainAgentTaskPayload = sanitizeMainAgentTaskPayload({
    ...current,
    ...input.patch,
    sessionId: input.sessionId,
    dashboardId: input.patch?.dashboardId ?? current.dashboardId,
    dashboardName: input.patch?.dashboardName ?? current.dashboardName,
    events: nextEvents,
    updatedAt: input.patch?.updatedAt ?? input.event.createdAt,
  });

  return saveMainAgentTask({
    sessionId: input.sessionId,
    dashboardId: nextPayload.dashboardId,
    payload: nextPayload,
  });
}

async function ensureMainAgentTasksTable() {
  if (!globalThis.__mainAgentTaskTableReady) {
    globalThis.__mainAgentTaskTableReady = createMainAgentTasksTable();
  }

  await globalThis.__mainAgentTaskTableReady;
}

async function createMainAgentTasksTable() {
  const pool = getPgPool();
  await pool.query(`
    create table if not exists main_agent_tasks (
      session_id text primary key,
      dashboard_id text,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}
