import "server-only";

import type { UIMessageChunk } from "ai";
import { writeDebugLog } from "../logging/debug-log";

declare global {
  var __authoringAgentActiveStreams:
    | Map<string, ActiveAuthoringAgentStreamEntry>
    | undefined;
}

interface ActiveAuthoringAgentStreamEntry {
  subscribe: () => ReadableStream<UIMessageChunk>;
}

function getActiveStreamsMap() {
  if (!globalThis.__authoringAgentActiveStreams) {
    globalThis.__authoringAgentActiveStreams = new Map();
  }

  return globalThis.__authoringAgentActiveStreams;
}

export function registerAuthoringAgentActiveStream(input: {
  sessionKey: string;
  stream: ReadableStream<UIMessageChunk>;
}) {
  const streams = getActiveStreamsMap();
  const subscribers = new Set<ReadableStreamDefaultController<UIMessageChunk>>();

  const entry: ActiveAuthoringAgentStreamEntry = {
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

  streams.set(input.sessionKey, entry);
  void writeDebugLog("agent-chat-flow", "stream-registered", {
    sessionKey: input.sessionKey,
  });
  const primaryStream = entry.subscribe();

  void pumpActiveStream({
    sessionKey: input.sessionKey,
    source: input.stream,
    subscribers,
  });

  return primaryStream;
}

export function getAuthoringAgentActiveStream(sessionKey: string) {
  return getActiveStreamsMap().get(sessionKey)?.subscribe() ?? null;
}

async function pumpActiveStream(input: {
  sessionKey: string;
  source: ReadableStream<UIMessageChunk>;
  subscribers: Set<ReadableStreamDefaultController<UIMessageChunk>>;
}) {
  const reader = input.source.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        await writeDebugLog("agent-chat-flow", "stream-source-ended", {
          sessionKey: input.sessionKey,
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
    await writeDebugLog("agent-chat-flow", "stream-pump-complete", {
      sessionKey: input.sessionKey,
    });
  } catch (error) {
    await writeDebugLog("agent-chat-flow", "stream-pump-error", {
      sessionKey: input.sessionKey,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error,
    });
    for (const controller of input.subscribers) {
      try {
        controller.error(error);
      } catch {
        input.subscribers.delete(controller);
      }
    }
  } finally {
    getActiveStreamsMap().delete(input.sessionKey);
    reader.releaseLock();
    await writeDebugLog("agent-chat-flow", "stream-unregistered", {
      sessionKey: input.sessionKey,
    });
  }
}
