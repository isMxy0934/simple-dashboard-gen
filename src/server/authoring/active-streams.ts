import "server-only";

import { randomUUID } from "crypto";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";
import { getPgPool } from "@/server/datasource/postgres";

declare global {
  var __authoringActiveStreams:
    | Map<string, ActiveAuthoringStreamEntry>
    | undefined;
}

interface ActiveAuthoringStreamEntry {
  id: string;
  leaseOwnerId: string;
  buffer: Uint8Array[];
  subscribe: () => ReadableStream<Uint8Array>;
}

function getActiveStreamsMap() {
  if (!globalThis.__authoringActiveStreams) {
    globalThis.__authoringActiveStreams = new Map();
  }

  return globalThis.__authoringActiveStreams;
}

const STREAM_LEASE_SECONDS = 300;
const STREAM_REPLAY_CHUNK_LIMIT = 200;

async function acquireAuthoringStreamLease(input: {
  sessionId: string;
  dashboardId?: string | null;
  turnId?: string | null;
  ownerId: string;
}): Promise<boolean> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<{ owner_id: string }>(
    `
      insert into authoring_stream_leases (
        session_id,
        owner_id,
        dashboard_id,
        turn_id,
        expires_at
      )
      values ($1, $2, $3, $4, now() + ($5::text || ' seconds')::interval)
      on conflict (session_id)
      do update set
        owner_id = excluded.owner_id,
        dashboard_id = excluded.dashboard_id,
        turn_id = excluded.turn_id,
        expires_at = excluded.expires_at,
        updated_at = now()
      where authoring_stream_leases.expires_at < now()
      returning owner_id
    `,
    [
      input.sessionId,
      input.ownerId,
      input.dashboardId ?? null,
      input.turnId ?? null,
      STREAM_LEASE_SECONDS,
    ],
  );

  return result.rows[0]?.owner_id === input.ownerId;
}

async function releaseAuthoringStreamLease(input: {
  sessionId: string;
  ownerId: string;
}) {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  await pool.query(
    `
      delete from authoring_stream_leases
      where session_id = $1 and owner_id = $2
    `,
    [input.sessionId, input.ownerId],
  );
}

export async function registerAuthoringActiveStream(input: {
  sessionId: string;
  dashboardId?: string | null;
  turnId?: string | null;
  stream: ReadableStream<Uint8Array>;
}): Promise<ReadableStream<Uint8Array> | null> {
  const streams = getActiveStreamsMap();
  if (streams.has(input.sessionId)) {
    void writeSessionTraceEvent({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      turnId: input.turnId,
      scope: "authoring-chat-flow",
      event: "stream_register_rejected_active_session",
      status: "errored",
    });
    return null;
  }

  const ownerId = `${Date.now()}_${randomUUID()}`;
  const leaseAcquired = await acquireAuthoringStreamLease({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    turnId: input.turnId,
    ownerId,
  }).catch((error) => {
    void writeSessionTraceEvent({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      turnId: input.turnId,
      scope: "authoring-chat-flow",
      event: "stream_lease_acquire_error",
      payload: error instanceof Error ? { message: error.message } : error,
      status: "errored",
    });
    return false;
  });
  if (!leaseAcquired) {
    void writeSessionTraceEvent({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      turnId: input.turnId,
      scope: "authoring-chat-flow",
      event: "stream_register_rejected_active_lease",
      status: "errored",
    });
    return null;
  }

  const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();

  const entry: ActiveAuthoringStreamEntry = {
    id: ownerId,
    leaseOwnerId: ownerId,
    buffer: [],
    subscribe: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of entry.buffer) {
            controller.enqueue(chunk);
          }
          subscribers.add(controller);
        },
        cancel() {
          subscribers.forEach((controller) => {
            if (controller.desiredSize === null) {
              subscribers.delete(controller);
            }
          });
        },
      }),
  };

  streams.set(input.sessionId, entry);
  void writeSessionTraceEvent({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    turnId: input.turnId,
    scope: "authoring-chat-flow",
    event: "stream_registered",
  });
  const primaryStream = entry.subscribe();

  void pumpActiveStream({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    turnId: input.turnId,
    source: input.stream,
    subscribers,
    entry,
  });

  return primaryStream;
}

export function getAuthoringActiveStream(sessionId: string) {
  return getActiveStreamsMap().get(sessionId)?.subscribe() ?? null;
}

export function hasAuthoringActiveStream(sessionId: string) {
  return getActiveStreamsMap().has(sessionId);
}

async function pumpActiveStream(input: {
  sessionId: string;
  dashboardId?: string | null;
  turnId?: string | null;
  source: ReadableStream<Uint8Array>;
  subscribers: Set<ReadableStreamDefaultController<Uint8Array>>;
  entry: ActiveAuthoringStreamEntry;
}) {
  const reader = input.source.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        await writeSessionTraceEvent({
          sessionId: input.sessionId,
          dashboardId: input.dashboardId,
          turnId: input.turnId,
          scope: "authoring-chat-flow",
          event: "stream_source_ended",
        });
        break;
      }

      input.entry.buffer.push(value);
      if (input.entry.buffer.length > STREAM_REPLAY_CHUNK_LIMIT) {
        input.entry.buffer.splice(
          0,
          input.entry.buffer.length - STREAM_REPLAY_CHUNK_LIMIT,
        );
      }

      for (const controller of input.subscribers) {
        try {
          controller.enqueue(value);
        } catch {
          input.subscribers.delete(controller);
        }
      }
    }

    for (const controller of input.subscribers) {
      try {
        controller.close();
      } catch {
        input.subscribers.delete(controller);
      }
    }
    await writeSessionTraceEvent({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      turnId: input.turnId,
      scope: "authoring-chat-flow",
      event: "stream_pump_complete",
    });
  } catch (error) {
    await writeSessionTraceEvent({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      turnId: input.turnId,
      scope: "authoring-chat-flow",
      event: "stream_pump_error",
      payload:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error,
      status: "errored",
    });
    for (const controller of input.subscribers) {
      try {
        controller.error(error);
      } catch {
        input.subscribers.delete(controller);
      }
    }
  } finally {
    const streams = getActiveStreamsMap();
    if (streams.get(input.sessionId)?.id === input.entry.id) {
      streams.delete(input.sessionId);
    }
    reader.releaseLock();
    await writeSessionTraceEvent({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      turnId: input.turnId,
      scope: "authoring-chat-flow",
      event: "stream_unregistered",
    });
    await releaseAuthoringStreamLease({
      sessionId: input.sessionId,
      ownerId: input.entry.leaseOwnerId,
    }).catch((error) =>
      writeSessionTraceEvent({
        sessionId: input.sessionId,
        dashboardId: input.dashboardId,
        turnId: input.turnId,
        scope: "authoring-chat-flow",
        event: "stream_lease_release_error",
        payload: error instanceof Error ? { message: error.message } : error,
        status: "errored",
      }),
    );
  }
}
