import "server-only";

import type { QueryResultRow } from "pg";
import type { MainAgentChatSessionPayload } from "@/ai/main-agent/contracts/session-state";
import { getPgPool } from "@/server/datasource/postgres";

declare global {
  var __mainAgentChatSessionTableReady: Promise<void> | undefined;
}

interface MainAgentChatSessionRow extends QueryResultRow {
  session_id: string;
  dashboard_id: string | null;
  payload: MainAgentChatSessionPayload;
  updated_at: string | Date;
}

export async function getMainAgentChatSession(
  sessionId: string,
): Promise<MainAgentChatSessionPayload | null> {
  await ensureMainAgentChatSessionsTable();

  const pool = getPgPool();
  const result = await pool.query<MainAgentChatSessionRow>(
    `
      select session_id, dashboard_id, payload, updated_at
      from main_agent_chat_sessions
      where session_id = $1
      limit 1
    `,
    [sessionId],
  );

  return result.rows[0]?.payload ?? null;
}

export async function saveMainAgentChatSession(input: {
  sessionId: string;
  dashboardId?: string | null;
  payload: MainAgentChatSessionPayload;
}) {
  await ensureMainAgentChatSessionsTable();

  const pool = getPgPool();
  const result = await pool.query<{
    updated_at: string | Date;
  }>(
    `
      insert into main_agent_chat_sessions (session_id, dashboard_id, payload)
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

async function ensureMainAgentChatSessionsTable() {
  if (!globalThis.__mainAgentChatSessionTableReady) {
    globalThis.__mainAgentChatSessionTableReady =
      createMainAgentChatSessionsTable();
  }

  await globalThis.__mainAgentChatSessionTableReady;
}

async function createMainAgentChatSessionsTable() {
  const pool = getPgPool();
  await pool.query(`
    create table if not exists main_agent_chat_sessions (
      session_id text primary key,
      dashboard_id text,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}
