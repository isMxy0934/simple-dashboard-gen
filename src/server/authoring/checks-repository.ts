import "server-only";

import type { QueryResultRow } from "pg";
import type { ViewCheckSnapshot } from "@/ai/authoring/contracts/tool-io";
import { getPgPool } from "@/server/datasource/postgres";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";

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
  workspaceId: string,
): Promise<ViewCheckSnapshot[]> {
  await ensureCloudAuthoringSchema();

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
  workspaceId: string;
  dashboardId: string;
  sessionId: string;
  checks: ViewCheckSnapshot[];
}) {
  await ensureCloudAuthoringSchema();
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
          input.workspaceId,
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
  workspaceId: string,
) {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  await pool.query(
    `
      delete from authoring_checks
      where workspace_id = $1 and dashboard_id = $2 and session_id = $3 and view_id = $4
    `,
    [workspaceId, dashboardId, sessionId, viewId],
  );
}
