import "server-only";

import type { UIMessageChunk } from "ai";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";

declare global {
  var __mainAgentActiveStreams:
    | Map<string, ActiveMainAgentStreamEntry>
    | undefined;
}

interface ActiveMainAgentStreamEntry {
  subscribe: () => ReadableStream<UIMessageChunk>;
}

function getActiveStreamsMap() {
  if (!globalThis.__mainAgentActiveStreams) {
    globalThis.__mainAgentActiveStreams = new Map();
  }

  return globalThis.__mainAgentActiveStreams;
}

export function registerMainAgentActiveStream(input: {
  sessionId: string;
  dashboardId?: string | null;
  turnId?: string | null;
  stream: ReadableStream<UIMessageChunk>;
}) {
  const streams = getActiveStreamsMap();
  const subscribers = new Set<ReadableStreamDefaultController<UIMessageChunk>>();

  const entry: ActiveMainAgentStreamEntry = {
    subscribe: () =>
      new ReadableStream<UIMessageChunk>({
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
    scope: "agent-chat-flow",
    event: "stream_registered",
  });
  const primaryStream = entry.subscribe();

  void pumpActiveStream({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    turnId: input.turnId,
    source: input.stream,
    subscribers,
  });

  return primaryStream;
}

export function getMainAgentActiveStream(sessionId: string) {
  return getActiveStreamsMap().get(sessionId)?.subscribe() ?? null;
}

export const registerAuthoringActiveStream = registerMainAgentActiveStream;
export const getAuthoringActiveStream = getMainAgentActiveStream;

async function pumpActiveStream(input: {
  sessionId: string;
  dashboardId?: string | null;
  turnId?: string | null;
  source: ReadableStream<UIMessageChunk>;
  subscribers: Set<ReadableStreamDefaultController<UIMessageChunk>>;
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
          scope: "agent-chat-flow",
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
      scope: "agent-chat-flow",
      event: "stream_pump_complete",
    });
  } catch (error) {
    await writeSessionTraceEvent({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      turnId: input.turnId,
      scope: "agent-chat-flow",
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
    getActiveStreamsMap().delete(input.sessionId);
    reader.releaseLock();
    await writeSessionTraceEvent({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      turnId: input.turnId,
      scope: "agent-chat-flow",
      event: "stream_unregistered",
    });
  }
}
