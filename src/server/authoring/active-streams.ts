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

export async function releaseAuthoringStreamSlot(input: {
  sessionId: string;
  ownerId: string;
  dashboardId?: string | null;
  turnId?: string | null;
}): Promise<void> {
  await releaseAuthoringStreamLease({
    sessionId: input.sessionId,
    ownerId: input.ownerId,
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

/**
 * Acquire the DB stream lease BEFORE starting the agent turn.
 * Returns an opaque `ownerId` string on success, or `null` if the session
 * already has an active lease (concurrent request).
 *
 * Callers should pass the returned `ownerId` to `registerAuthoringActiveStream`
 * so the registration step skips re-acquiring the lease.
 */
export async function reserveAuthoringStreamSlot(input: {
  sessionId: string;
  dashboardId?: string | null;
  turnId?: string | null;
}): Promise<string | null> {
  const streams = getActiveStreamsMap();
  if (streams.has(input.sessionId)) {
    void writeSessionTraceEvent({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      turnId: input.turnId,
      scope: "authoring-chat-flow",
      event: "stream_reserve_rejected_active_session",
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
      event: "stream_reserve_lease_error",
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
      event: "stream_reserve_rejected_active_lease",
      status: "errored",
    });
    return null;
  }
  return ownerId;
}

export async function registerAuthoringActiveStream(input: {
  sessionId: string;
  dashboardId?: string | null;
  turnId?: string | null;
  stream: ReadableStream<Uint8Array>;
  /** Pre-acquired lease owner ID from `reserveAuthoringStreamSlot`. */
  ownerId: string;
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

  const { ownerId } = input;

  const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();

  const entry: ActiveAuthoringStreamEntry = {
    id: ownerId,
    leaseOwnerId: ownerId,
    buffer: [],
    subscribe: () => {
      // Capture the controller so the cancel callback (which receives `reason`,
      // not the controller) can remove exactly this subscriber from the set.
      // The old implementation passed the wrong argument to subscribers.delete(),
      // causing a memory leak when consumers cancelled their streams.
      let myController: ReadableStreamDefaultController<Uint8Array> | null = null;
      return new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of entry.buffer) {
            controller.enqueue(chunk);
          }
          subscribers.add(controller);
          myController = controller;
        },
        cancel() {
          if (myController) {
            subscribers.delete(myController);
            myController = null;
          }
        },
      });
    },
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

export async function hasAuthoringActiveStream(sessionId: string) {
  if (getActiveStreamsMap().has(sessionId)) {
    return true;
  }

  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<{ exists: boolean }>(
    `
      select exists (
        select 1
        from authoring_stream_leases
        where session_id = $1 and expires_at > now()
      ) as exists
    `,
    [sessionId],
  );
  return result.rows[0]?.exists === true;
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
    await releaseAuthoringStreamSlot({
      sessionId: input.sessionId,
      ownerId: input.entry.leaseOwnerId,
      dashboardId: input.dashboardId,
      turnId: input.turnId,
    });
  }
}
