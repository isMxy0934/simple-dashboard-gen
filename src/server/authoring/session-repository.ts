import "server-only";

import type { QueryResultRow } from "pg";
import type { AuthoringChatSessionPayload } from "@/ai/authoring/contracts/session-state";
import { getPgPool } from "@/server/datasource/postgres";

declare global {
  var __authoringChatSessionTableReady: Promise<void> | undefined;
}

interface AuthoringChatSessionRow extends QueryResultRow {
  session_id: string;
  dashboard_id: string | null;
  payload: AuthoringChatSessionPayload;
  updated_at: string | Date;
}

export async function getAuthoringChatSession(
  sessionId: string,
): Promise<AuthoringChatSessionPayload | null> {
  await ensureAuthoringChatSessionsTable();

  const pool = getPgPool();
  const result = await pool.query<AuthoringChatSessionRow>(
    `
      select session_id, dashboard_id, payload, updated_at
      from authoring_chat_sessions
      where session_id = $1
      limit 1
    `,
    [sessionId],
  );

  return result.rows[0]?.payload ?? null;
}

export async function saveAuthoringChatSession(input: {
  sessionId: string;
  dashboardId?: string | null;
  payload: AuthoringChatSessionPayload;
}) {
  await ensureAuthoringChatSessionsTable();

  const pool = getPgPool();
  const result = await pool.query<{
    updated_at: string | Date;
  }>(
    `
      insert into authoring_chat_sessions (session_id, dashboard_id, payload)
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

async function ensureAuthoringChatSessionsTable() {
  if (!globalThis.__authoringChatSessionTableReady) {
    globalThis.__authoringChatSessionTableReady =
      createAuthoringChatSessionsTable();
  }

  await globalThis.__authoringChatSessionTableReady;
}

async function createAuthoringChatSessionsTable() {
  const pool = getPgPool();
  await pool.query(`
    create table if not exists authoring_chat_sessions (
      session_id text primary key,
      dashboard_id text,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}

export const getMainAgentChatSession = getAuthoringChatSession;
export const saveMainAgentChatSession = saveAuthoringChatSession;
