import "server-only";

import type { QueryResultRow } from "pg";
import {
  buildEmptyDashboardAgentTaskState,
  sanitizeDashboardAgentTaskPayload,
  type DashboardAgentTaskEvent,
  type DashboardAgentTaskPayload,
} from "@/agent/dashboard-agent/contracts/task-state";
import { getPgPool } from "@/server/datasource/postgres";

declare global {
  var __dashboardAgentTaskTableReady: Promise<void> | undefined;
}

interface DashboardAgentTaskRow extends QueryResultRow {
  session_id: string;
  dashboard_id: string | null;
  payload: DashboardAgentTaskPayload;
  updated_at: string | Date;
}

export async function getDashboardAgentTask(
  sessionId: string,
): Promise<DashboardAgentTaskPayload | null> {
  await ensureDashboardAgentTasksTable();

  const pool = getPgPool();
  const result = await pool.query<DashboardAgentTaskRow>(
    `
      select session_id, dashboard_id, payload, updated_at
      from dashboard_agent_tasks
      where session_id = $1
      limit 1
    `,
    [sessionId],
  );

  const row = result.rows[0];
  return row ? sanitizeDashboardAgentTaskPayload(row.payload) : null;
}

export async function saveDashboardAgentTask(input: {
  sessionId: string;
  dashboardId?: string | null;
  payload: DashboardAgentTaskPayload;
}) {
  await ensureDashboardAgentTasksTable();

  const pool = getPgPool();
  const payload = sanitizeDashboardAgentTaskPayload(input.payload);
  const result = await pool.query<{ updated_at: string | Date }>(
    `
      insert into dashboard_agent_tasks (session_id, dashboard_id, payload)
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

export async function syncDashboardAgentTaskSnapshot(input: {
  sessionId: string;
  snapshot: Omit<
    DashboardAgentTaskPayload,
    "version" | "events" | "intervention"
  >;
  dashboardName?: string;
}) {
  const current =
    (await getDashboardAgentTask(input.sessionId)) ??
    buildEmptyDashboardAgentTaskState({
      sessionId: input.sessionId,
      dashboardId: input.snapshot.dashboardId,
      dashboardName: input.dashboardName ?? input.snapshot.dashboardName,
      updatedAt: input.snapshot.updatedAt,
    });

  return saveDashboardAgentTask({
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

export async function appendDashboardAgentTaskEvent(input: {
  sessionId: string;
  event: DashboardAgentTaskEvent;
  patch?: Partial<
    Omit<DashboardAgentTaskPayload, "version" | "sessionId" | "events">
  >;
}) {
  const current =
    (await getDashboardAgentTask(input.sessionId)) ??
    buildEmptyDashboardAgentTaskState({
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
  const nextPayload: DashboardAgentTaskPayload = sanitizeDashboardAgentTaskPayload({
    ...current,
    ...input.patch,
    sessionId: input.sessionId,
    dashboardId: input.patch?.dashboardId ?? current.dashboardId,
    dashboardName: input.patch?.dashboardName ?? current.dashboardName,
    events: nextEvents,
    updatedAt: input.patch?.updatedAt ?? input.event.createdAt,
  });

  return saveDashboardAgentTask({
    sessionId: input.sessionId,
    dashboardId: nextPayload.dashboardId,
    payload: nextPayload,
  });
}

async function ensureDashboardAgentTasksTable() {
  if (!globalThis.__dashboardAgentTaskTableReady) {
    globalThis.__dashboardAgentTaskTableReady = createDashboardAgentTasksTable();
  }

  await globalThis.__dashboardAgentTaskTableReady;
}

async function createDashboardAgentTasksTable() {
  const pool = getPgPool();
  await pool.query(`
    create table if not exists dashboard_agent_tasks (
      session_id text primary key,
      dashboard_id text,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}
