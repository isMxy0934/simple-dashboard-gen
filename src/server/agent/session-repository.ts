import "server-only";

import type { QueryResultRow } from "pg";
import type { DashboardAgentSessionPayload } from "@/ai/dashboard-agent/contracts/session-state";
import { getPgPool } from "@/server/datasource/postgres";

declare global {
  var __dashboardAgentSessionTableReady: Promise<void> | undefined;
}

interface DashboardAgentSessionRow extends QueryResultRow {
  session_id: string;
  dashboard_id: string | null;
  payload: DashboardAgentSessionPayload;
  updated_at: string | Date;
}

export async function getDashboardAgentSession(
  sessionId: string,
): Promise<DashboardAgentSessionPayload | null> {
  await ensureDashboardAgentSessionsTable();

  const pool = getPgPool();
  const result = await pool.query<DashboardAgentSessionRow>(
    `
      select session_id, dashboard_id, payload, updated_at
      from dashboard_agent_sessions
      where session_id = $1
      limit 1
    `,
    [sessionId],
  );

  return result.rows[0]?.payload ?? null;
}

export async function saveDashboardAgentSession(input: {
  sessionId: string;
  dashboardId?: string | null;
  payload: DashboardAgentSessionPayload;
}) {
  await ensureDashboardAgentSessionsTable();

  const pool = getPgPool();
  const result = await pool.query<{
    updated_at: string | Date;
  }>(
    `
      insert into dashboard_agent_sessions (session_id, dashboard_id, payload)
      values ($1, $2, $3::jsonb)
      on conflict (session_id)
      do update set
        dashboard_id = excluded.dashboard_id,
        payload = excluded.payload,
        updated_at = now()
      returning updated_at
    `,
    [input.sessionId, input.dashboardId ?? null, JSON.stringify(input.payload)],
  );

  return {
    session_id: input.sessionId,
    dashboard_id: input.dashboardId ?? null,
    updated_at: new Date(result.rows[0].updated_at).toISOString(),
  };
}

async function ensureDashboardAgentSessionsTable() {
  if (!globalThis.__dashboardAgentSessionTableReady) {
    globalThis.__dashboardAgentSessionTableReady =
      createDashboardAgentSessionsTable();
  }

  await globalThis.__dashboardAgentSessionTableReady;
}

async function createDashboardAgentSessionsTable() {
  const pool = getPgPool();
  await pool.query(`
    create table if not exists dashboard_agent_sessions (
      session_id text primary key,
      dashboard_id text,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}
