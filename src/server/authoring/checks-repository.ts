import "server-only";

import type { QueryResultRow } from "pg";
import type { ViewCheckSnapshot } from "@/ai/authoring/contracts/tool-io";
import { getPgPool } from "@/server/datasource/postgres";
import { DEFAULT_WORKSPACE_ID } from "@/shared/workspace-defaults";

declare global {
  var __authoringChecksTableReady: Promise<void> | undefined;
}

interface AuthoringCheckRow extends QueryResultRow {
  dashboard_id: string;
  session_id: string;
  view_id: string;
  payload: ViewCheckSnapshot;
  updated_at: string | Date;
}

export async function listAuthoringChecks(
  dashboardId: string,
  sessionId: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<ViewCheckSnapshot[]> {
  await ensureAuthoringChecksTable();

  const pool = getPgPool();
  const result = await pool.query<AuthoringCheckRow>(
    `
      select dashboard_id, session_id, view_id, payload, updated_at
      from authoring_checks
      where workspace_id = $1 and dashboard_id = $2 and session_id = $3
      order by view_id asc
    `,
    [workspaceId, dashboardId, sessionId],
  );

  return result.rows.map((row) => row.payload);
}

export async function saveAuthoringChecks(input: {
  workspaceId?: string;
  dashboardId: string;
  sessionId: string;
  checks: ViewCheckSnapshot[];
}) {
  await ensureAuthoringChecksTable();
  const pool = getPgPool();

  await Promise.all(
    input.checks.map((check) =>
      pool.query(
        `
          insert into authoring_checks (workspace_id, dashboard_id, session_id, view_id, payload)
          values ($1, $2, $3, $4, $5::jsonb)
          on conflict (workspace_id, dashboard_id, session_id, view_id)
          do update set payload = excluded.payload, updated_at = now()
        `,
        [
          input.workspaceId ?? DEFAULT_WORKSPACE_ID,
          input.dashboardId,
          input.sessionId,
          check.view_id,
          JSON.stringify(check),
        ],
      ),
    ),
  );
}

export async function deleteAuthoringCheck(
  dashboardId: string,
  sessionId: string,
  viewId: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
) {
  await ensureAuthoringChecksTable();
  const pool = getPgPool();
  await pool.query(
    `
      delete from authoring_checks
      where workspace_id = $1 and dashboard_id = $2 and session_id = $3 and view_id = $4
    `,
    [workspaceId, dashboardId, sessionId, viewId],
  );
}

async function ensureAuthoringChecksTable() {
  if (!globalThis.__authoringChecksTableReady) {
    globalThis.__authoringChecksTableReady = createAuthoringChecksTable();
  }

  await globalThis.__authoringChecksTableReady;
}

async function createAuthoringChecksTable() {
  const pool = getPgPool();
  await pool.query(`
    create table if not exists authoring_checks (
      workspace_id text not null,
      dashboard_id text not null,
      session_id text not null,
      view_id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (workspace_id, dashboard_id, session_id, view_id)
    )
  `);
  await pool.query(`
    do $$
    begin
      if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'workspaces'
      ) and not exists (
        select 1 from pg_constraint
        where conname = 'authoring_checks_workspace_fk'
      ) then
        alter table authoring_checks
        add constraint authoring_checks_workspace_fk
        foreign key (workspace_id)
        references workspaces(id)
        on delete cascade;
      end if;

      if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'workspace_dashboards'
      ) and not exists (
        select 1 from pg_constraint
        where conname = 'authoring_checks_dashboard_fk'
      ) then
        alter table authoring_checks
        add constraint authoring_checks_dashboard_fk
        foreign key (dashboard_id)
        references workspace_dashboards(id)
        on delete cascade;
      end if;
    end
    $$;
  `);
}
