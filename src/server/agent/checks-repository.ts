import "server-only";

import type { QueryResultRow } from "pg";
import type { ViewCheckSnapshot } from "@/agent/dashboard-agent/contracts/agent-contract";
import { getPgPool } from "@/server/datasource/postgres";

declare global {
  var __dashboardAgentChecksTableReady: Promise<void> | undefined;
}

interface DashboardAgentCheckRow extends QueryResultRow {
  dashboard_id: string;
  view_id: string;
  payload: ViewCheckSnapshot;
  updated_at: string | Date;
}

export async function listDashboardAgentChecks(
  dashboardId: string,
): Promise<ViewCheckSnapshot[]> {
  await ensureDashboardAgentChecksTable();

  const pool = getPgPool();
  const result = await pool.query<DashboardAgentCheckRow>(
    `
      select dashboard_id, view_id, payload, updated_at
      from dashboard_agent_checks
      where dashboard_id = $1
      order by view_id asc
    `,
    [dashboardId],
  );

  return result.rows.map((row) => row.payload);
}

export async function saveDashboardAgentChecks(input: {
  dashboardId: string;
  checks: ViewCheckSnapshot[];
}) {
  await ensureDashboardAgentChecksTable();
  const pool = getPgPool();

  await Promise.all(
    input.checks.map((check) =>
      pool.query(
        `
          insert into dashboard_agent_checks (dashboard_id, view_id, payload)
          values ($1, $2, $3::jsonb)
          on conflict (dashboard_id, view_id)
          do update set payload = excluded.payload, updated_at = now()
        `,
        [input.dashboardId, check.view_id, JSON.stringify(check)],
      ),
    ),
  );
}

export async function deleteDashboardAgentCheck(
  dashboardId: string,
  viewId: string,
) {
  await ensureDashboardAgentChecksTable();
  const pool = getPgPool();
  await pool.query(
    `
      delete from dashboard_agent_checks
      where dashboard_id = $1 and view_id = $2
    `,
    [dashboardId, viewId],
  );
}

async function ensureDashboardAgentChecksTable() {
  if (!globalThis.__dashboardAgentChecksTableReady) {
    globalThis.__dashboardAgentChecksTableReady = createDashboardAgentChecksTable();
  }

  await globalThis.__dashboardAgentChecksTableReady;
}

async function createDashboardAgentChecksTable() {
  const pool = getPgPool();
  await pool.query(`
    create table if not exists dashboard_agent_checks (
      dashboard_id text not null,
      view_id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (dashboard_id, view_id)
    )
  `);
}
