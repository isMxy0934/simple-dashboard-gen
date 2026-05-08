import "server-only";

import type { QueryResultRow } from "pg";
import {
  buildEmptyAuthoringTaskState,
  sanitizeAuthoringTaskPayload,
  type AuthoringTaskEvent,
  type AuthoringTaskPayload,
} from "@/ai/authoring/contracts/task-event";
import { getPgPool } from "@/server/datasource/postgres";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";

interface AuthoringTaskRow extends QueryResultRow {
  session_id: string;
  dashboard_id: string | null;
  payload: AuthoringTaskPayload;
  revision: number;
  updated_at: string | Date;
}

export async function getAuthoringTask(
  sessionId: string,
): Promise<AuthoringTaskPayload | null> {
  await ensureCloudAuthoringSchema();

  const pool = getPgPool();
  const result = await pool.query<AuthoringTaskRow>(
    `
      select session_id, dashboard_id, payload, updated_at
      from authoring_tasks
      where session_id = $1
      limit 1
    `,
    [sessionId],
  );

  const row = result.rows[0];
  return row ? sanitizeAuthoringTaskPayload(row.payload) : null;
}

export async function appendAuthoringTaskEvent(input: {
  sessionId: string;
  event: AuthoringTaskEvent;
  patch?: Partial<
    Omit<AuthoringTaskPayload, "version" | "sessionId" | "events">
  >;
}) {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `authoring_task:${input.sessionId}`,
    ]);
    await client.query(
      `
        insert into authoring_tasks (session_id, dashboard_id, payload)
        values ($1, $2, $3::jsonb)
        on conflict (session_id) do nothing
      `,
      [
        input.sessionId,
        input.patch?.dashboardId ?? null,
        JSON.stringify(
          buildEmptyAuthoringTaskState({
            sessionId: input.sessionId,
            dashboardId: input.patch?.dashboardId ?? null,
            dashboardName: input.patch?.dashboardName ?? "Untitled Dashboard",
            updatedAt: input.event.createdAt,
          }),
        ),
      ],
    );
    const currentResult = await client.query<AuthoringTaskRow>(
      `
        select session_id, dashboard_id, payload, revision, updated_at
        from authoring_tasks
        where session_id = $1
        for update
      `,
      [input.sessionId],
    );
    const current = sanitizeAuthoringTaskPayload(currentResult.rows[0].payload);
    const hasDuplicateDedupeKey =
      input.event.dedupeKey &&
      current.events.some((event) => event.dedupeKey === input.event.dedupeKey);

    const nextEvents = hasDuplicateDedupeKey
      ? current.events
      : [...current.events, input.event].slice(-40);
    const nextPayload: AuthoringTaskPayload = sanitizeAuthoringTaskPayload({
      ...current,
      ...input.patch,
      sessionId: input.sessionId,
      dashboardId: input.patch?.dashboardId ?? current.dashboardId,
      dashboardName: input.patch?.dashboardName ?? current.dashboardName,
      events: nextEvents,
      updatedAt: input.patch?.updatedAt ?? input.event.createdAt,
    });

    const saved = await client.query<AuthoringTaskRow>(
      `
        update authoring_tasks
        set
          dashboard_id = $2,
          payload = $3::jsonb,
          revision = revision + 1,
          updated_at = now()
        where session_id = $1
        returning session_id, dashboard_id, payload, revision, updated_at
      `,
      [
        input.sessionId,
        nextPayload.dashboardId,
        JSON.stringify(nextPayload),
      ],
    );
    await client.query("commit");
    const row = saved.rows[0];

    return {
      session_id: row.session_id,
      dashboard_id: row.dashboard_id,
      updated_at: new Date(row.updated_at).toISOString(),
      payload: sanitizeAuthoringTaskPayload(row.payload),
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
