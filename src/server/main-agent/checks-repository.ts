import "server-only";

import type { QueryResultRow } from "pg";
import type { ViewCheckSnapshot } from "@/ai/main-agent/contracts/agent-contract";
import { getPgPool } from "@/server/datasource/postgres";

declare global {
  var __workerChecksTableReady: Promise<void> | undefined;
}

interface MainAgentCheckRow extends QueryResultRow {
  dashboard_id: string;
  session_id: string;
  view_id: string;
  payload: ViewCheckSnapshot;
  updated_at: string | Date;
}

export async function listMainAgentChecks(
  dashboardId: string,
  sessionId: string,
  workspaceId = "ws_default",
): Promise<ViewCheckSnapshot[]> {
  await ensureWorkerChecksTable();

  const pool = getPgPool();
  const result = await pool.query<MainAgentCheckRow>(
    `
      select dashboard_id, session_id, view_id, payload, updated_at
      from worker_checks
      where workspace_id = $1 and dashboard_id = $2 and session_id = $3
      order by view_id asc
    `,
    [workspaceId, dashboardId, sessionId],
  );

  return result.rows.map((row) => row.payload);
}

export async function saveMainAgentChecks(input: {
  workspaceId?: string;
  dashboardId: string;
  sessionId: string;
  checks: ViewCheckSnapshot[];
}) {
  await ensureWorkerChecksTable();
  const pool = getPgPool();

  await Promise.all(
    input.checks.map((check) =>
      pool.query(
        `
          insert into worker_checks (workspace_id, dashboard_id, session_id, view_id, payload)
          values ($1, $2, $3, $4, $5::jsonb)
          on conflict (workspace_id, dashboard_id, session_id, view_id)
          do update set payload = excluded.payload, updated_at = now()
        `,
        [
          input.workspaceId ?? "ws_default",
          input.dashboardId,
          input.sessionId,
          check.view_id,
          JSON.stringify(check),
        ],
      ),
    ),
  );
}

export async function deleteMainAgentCheck(
  dashboardId: string,
  sessionId: string,
  viewId: string,
  workspaceId = "ws_default",
) {
  await ensureWorkerChecksTable();
  const pool = getPgPool();
  await pool.query(
    `
      delete from worker_checks
      where workspace_id = $1 and dashboard_id = $2 and session_id = $3 and view_id = $4
    `,
    [workspaceId, dashboardId, sessionId, viewId],
  );
}

async function ensureWorkerChecksTable() {
  if (!globalThis.__workerChecksTableReady) {
    globalThis.__workerChecksTableReady = createWorkerChecksTable();
  }

  await globalThis.__workerChecksTableReady;
}

async function createWorkerChecksTable() {
  const pool = getPgPool();
  await pool.query(`
    create table if not exists worker_checks (
      workspace_id text not null,
      dashboard_id text not null,
      session_id text not null,
      view_id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (workspace_id, dashboard_id, session_id, view_id)
    )
  `);
}
