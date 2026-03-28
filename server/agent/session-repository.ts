import "server-only";

import type { QueryResultRow } from "pg";
import type { PersistedAuthoringAgentSessionPayload } from "../../ai/runtime/agent-session-state";
import { getPgPool } from "../datasource/postgres";

declare global {
  var __authoringAgentSessionTableReady: Promise<void> | undefined;
}

interface AuthoringAgentSessionRow extends QueryResultRow {
  session_key: string;
  payload: PersistedAuthoringAgentSessionPayload;
  updated_at: string | Date;
}

export async function getAuthoringAgentSession(
  sessionKey: string,
): Promise<PersistedAuthoringAgentSessionPayload | null> {
  await ensureAuthoringAgentSessionsTable();

  const pool = getPgPool();
  const result = await pool.query<AuthoringAgentSessionRow>(
    `
      select session_key, payload, updated_at
      from authoring_agent_sessions
      where session_key = $1
      limit 1
    `,
    [sessionKey],
  );

  return result.rows[0]?.payload ?? null;
}

export async function saveAuthoringAgentSession(input: {
  sessionKey: string;
  payload: PersistedAuthoringAgentSessionPayload;
}) {
  await ensureAuthoringAgentSessionsTable();

  const pool = getPgPool();
  const result = await pool.query<{
    updated_at: string | Date;
  }>(
    `
      insert into authoring_agent_sessions (session_key, payload)
      values ($1, $2::jsonb)
      on conflict (session_key)
      do update set payload = excluded.payload, updated_at = now()
      returning updated_at
    `,
    [input.sessionKey, JSON.stringify(input.payload)],
  );

  return {
    session_key: input.sessionKey,
    updated_at: new Date(result.rows[0].updated_at).toISOString(),
  };
}

async function ensureAuthoringAgentSessionsTable() {
  if (!globalThis.__authoringAgentSessionTableReady) {
    globalThis.__authoringAgentSessionTableReady = createAuthoringAgentSessionsTable();
  }

  await globalThis.__authoringAgentSessionTableReady;
}

async function createAuthoringAgentSessionsTable() {
  const pool = getPgPool();
  await pool.query(`
    create table if not exists authoring_agent_sessions (
      session_key text primary key,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}
