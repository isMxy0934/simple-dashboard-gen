import "server-only";

import { randomUUID } from "crypto";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";

declare global {
  var __authoringActiveStreams:
    | Map<string, ActiveAuthoringStreamEntry>
    | undefined;
}

interface ActiveAuthoringStreamEntry {
  id: string;
  subscribe: () => ReadableStream<Uint8Array>;
}

function getActiveStreamsMap() {
  if (!globalThis.__authoringActiveStreams) {
    globalThis.__authoringActiveStreams = new Map();
  }

  return globalThis.__authoringActiveStreams;
}

export function registerAuthoringActiveStream(input: {
  sessionId: string;
  dashboardId?: string | null;
  turnId?: string | null;
  stream: ReadableStream<Uint8Array>;
}): ReadableStream<Uint8Array> | null {
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

  const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();

  const entry: ActiveAuthoringStreamEntry = {
    id: `${Date.now()}_${randomUUID()}`,
    subscribe: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
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
  }
}
