import "server-only";

import { randomUUID } from "crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
  type AuthoringChatSessionPayload,
} from "@/ai/authoring/contracts/session";
import {
  buildEmptyAuthoringChatSessionState,
  sanitizeAuthoringChatSessionPayload,
  sanitizeAuthoringRunCheckStateSnapshot,
  sanitizeAuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/runtime/session-sanitize";
import { getPgPool } from "@/server/datasource/postgres";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";

interface AuthoringChatEventRow extends QueryResultRow {
  session_id: string;
  dashboard_id: string | null;
  turn_id: string;
  event_seq: number;
  sequence: number;
  event_type: string;
  message_id: string | null;
  payload: unknown;
  created_at: string | Date;
}

export interface AuthoringChatSessionSummaryRow {
  session_id: string;
  dashboard_id: string | null;
  payload: AuthoringChatSessionPayload;
  updated_at: string;
}

function emptySessionPayload(input: {
  sessionId: string;
  dashboardId?: string | null;
  updatedAt?: string;
}): AuthoringChatSessionPayload {
  return {
    version: AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
    ...buildEmptyAuthoringChatSessionState({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
    }),
    updatedAt: input.updatedAt ?? new Date(0).toISOString(),
  };
}

function eventPayloadRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rebuildSessionFromEvents(input: {
  sessionId: string;
  rows: AuthoringChatEventRow[];
}): AuthoringChatSessionPayload | null {
  if (input.rows.length === 0) {
    return null;
  }

  let dashboardId: string | null = null;
  let updatedAt = new Date(0).toISOString();
  let session = emptySessionPayload({
    sessionId: input.sessionId,
    dashboardId,
    updatedAt,
  });

  for (const row of input.rows) {
    dashboardId = row.dashboard_id ?? dashboardId;
    updatedAt = new Date(row.created_at).toISOString();
    const payload = eventPayloadRecord(row.payload);

    if (row.event_type === "session_initialized") {
      session = sanitizeAuthoringChatSessionPayload({
        ...session,
        sessionId: input.sessionId,
        dashboardId,
        updatedAt,
      });
      continue;
    }

    if (row.event_type === "message_appended") {
      const message = payload.message as AgentMessage | undefined;
      if (message) {
        session = sanitizeAuthoringChatSessionPayload({
          ...session,
          dashboardId,
          messages: [...session.messages, message],
          updatedAt,
        });
      }
      continue;
    }

    if (row.event_type === "prompt_snapshot") {
      session = sanitizeAuthoringChatSessionPayload({
        ...session,
        dashboardId,
        prompt: {
          lastContextFingerprint:
            typeof payload.lastContextFingerprint === "string"
              ? payload.lastContextFingerprint
              : payload.lastContextFingerprint === null
                ? null
                : session.prompt.lastContextFingerprint,
          workingDraft: sanitizeAuthoringWorkingDraftSnapshot(
            (payload.workingDraft ?? session.prompt.workingDraft) as never,
          ),
          lastRunCheckState: sanitizeAuthoringRunCheckStateSnapshot(
            (payload.lastRunCheckState ?? session.prompt.lastRunCheckState) as never,
          ),
        },
        updatedAt,
      });
    }
  }

  return sanitizeAuthoringChatSessionPayload({
    ...session,
    dashboardId,
    updatedAt,
  });
}

async function listSessionEvents(
  sessionId: string,
  client?: PoolClient,
): Promise<AuthoringChatEventRow[]> {
  const executor = client ?? getPgPool();
  const result = await executor.query<AuthoringChatEventRow>(
    `
      select session_id, dashboard_id, turn_id, event_seq, sequence, event_type, message_id, payload, created_at
      from authoring_chat_events
      where session_id = $1
      order by sequence asc
    `,
    [sessionId],
  );

  return result.rows;
}

export async function getAuthoringChatSession(
  sessionId: string,
): Promise<AuthoringChatSessionPayload | null> {
  await ensureCloudAuthoringSchema();
  return rebuildSessionFromEvents({
    sessionId,
    rows: await listSessionEvents(sessionId),
  });
}

export async function saveAuthoringChatSession(input: {
  sessionId: string;
  dashboardId?: string | null;
  payload: AuthoringChatSessionPayload;
}) {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const client = await pool.connect();
  let updatedAt = new Date().toISOString();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `authoring_chat:${input.sessionId}`,
    ]);
    const currentRows = await listSessionEvents(input.sessionId, client);
    const current = rebuildSessionFromEvents({
      sessionId: input.sessionId,
      rows: currentRows,
    });
    const currentMessages = current?.messages ?? [];
    const nextMessages = input.payload.messages ?? [];
    const appendedMessages = nextMessages.slice(currentMessages.length);
    const turnId = `turn_${Date.now()}_${randomUUID()}`;
    const events: Array<{
      eventType: string;
      messageId?: string | null;
      payload: unknown;
    }> = [];

    if (!current) {
      events.push({
        eventType: "session_initialized",
        payload: {
          version: AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
        },
      });
    }

    appendedMessages.forEach((message, index) => {
      events.push({
        eventType: "message_appended",
        messageId: `msg_${currentMessages.length + index}_${Date.now()}_${randomUUID()}`,
        payload: { message },
      });
    });

    events.push({
      eventType: "prompt_snapshot",
      payload: {
        lastContextFingerprint: input.payload.prompt.lastContextFingerprint,
        workingDraft: input.payload.prompt.workingDraft,
        lastRunCheckState: input.payload.prompt.lastRunCheckState,
      },
    });

    const latestSequenceResult = await client.query<{ latest_sequence: string | number | null }>(
      `
        select coalesce(max(sequence), 0) as latest_sequence
        from authoring_chat_events
        where session_id = $1
      `,
      [input.sessionId],
    );
    const latestSequence = Number(latestSequenceResult.rows[0]?.latest_sequence ?? 0);

    for (const [index, event] of events.entries()) {
      const result = await client.query<{ created_at: string | Date }>(
        `
          insert into authoring_chat_events (
            session_id,
            dashboard_id,
            turn_id,
            event_seq,
            sequence,
            event_type,
            message_id,
            payload
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
          returning created_at
        `,
        [
          input.sessionId,
          input.dashboardId ?? input.payload.dashboardId ?? null,
          turnId,
          index,
          latestSequence + index + 1,
          event.eventType,
          event.messageId ?? null,
          JSON.stringify(event.payload),
        ],
      );
      updatedAt = new Date(result.rows[0].created_at).toISOString();
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return {
    session_id: input.sessionId,
    dashboard_id: input.dashboardId ?? input.payload.dashboardId ?? null,
    updated_at: updatedAt,
  };
}

export async function listAuthoringChatSessions(input: {
  dashboardId: string;
  sessionIdPrefix: string;
  limit?: number;
}): Promise<AuthoringChatSessionSummaryRow[]> {
  await ensureCloudAuthoringSchema();

  const pool = getPgPool();
  const result = await pool.query<{
    session_id: string;
    dashboard_id: string | null;
    updated_at: string | Date;
  }>(
    `
      select session_id, max(dashboard_id) as dashboard_id, max(created_at) as updated_at
      from authoring_chat_events
      where dashboard_id = $1
        and substring(session_id from 1 for length($2)) = $2
      group by session_id
      order by max(created_at) desc
      limit $3
    `,
    [
      input.dashboardId,
      input.sessionIdPrefix,
      Math.max(1, Math.min(input.limit ?? 50, 100)),
    ],
  );

  const rows = await Promise.all(
    result.rows.map(async (row) => ({
      row,
      payload: await getAuthoringChatSession(row.session_id),
    })),
  );

  return rows.flatMap(({ row, payload }) =>
    payload
      ? [{
          session_id: row.session_id,
          dashboard_id: row.dashboard_id,
          payload,
          updated_at: new Date(row.updated_at).toISOString(),
        }]
      : [],
  );
}
