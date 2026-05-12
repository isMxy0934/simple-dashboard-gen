"use client";

import type { AgentEvent } from "@mariozechner/pi-agent-core";

interface AuthoringAgentProtocolEvent {
  protocol: "authoring-agent-v1";
  event: AgentEvent;
}

export interface DrainSseStreamCallbacks {
  /** Called for each successfully parsed authoring-agent-v1 event. */
  onEvent: (event: AgentEvent) => void;
  /** Called once the stream ends cleanly (done = true). */
  onDone: () => void;
  /** Called when the stream is cancelled via the AbortSignal. */
  onAbort: () => void;
  /** Called on any non-abort read error. */
  onError: (error: Error) => void;
}

/**
 * Reads and parses an authoring agent SSE stream to completion.
 * Frames are split on `\n\n`; only `data:` lines are parsed.
 * Malformed frames are skipped with a console.warn rather than crashing.
 *
 * Callers are responsible for calling `reader.releaseLock()` in their finally
 * block if they retain the reader, but this function releases its own lock
 * in its own finally clause.
 */
export async function drainAuthoringSseStream(
  body: ReadableStream<Uint8Array>,
  callbacks: DrainSseStreamCallbacks,
  abortSignal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        callbacks.onDone();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const dataLine = frame
          .split(/\r?\n/)
          .find((line) => line.startsWith("data: "));
        if (!dataLine) {
          continue;
        }
        try {
          const parsed = JSON.parse(dataLine.slice(6)) as AuthoringAgentProtocolEvent;
          if (parsed.protocol === "authoring-agent-v1") {
            callbacks.onEvent(parsed.event);
          }
        } catch {
          console.warn(
            "[drain-sse-stream] Unparseable SSE frame, skipping:",
            dataLine.slice(6, 80),
          );
        }
      }
    }
  } catch (error) {
    if (abortSignal?.aborted) {
      callbacks.onAbort();
      return;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    callbacks.onError(err);
    // Re-throw so the caller's awaited promise rejects. The callback has
    // already updated UI state (e.g. setAgentError), but the calling scope
    // also needs to know that streaming failed (e.g. to restore the prompt).
    throw err;
  } finally {
    reader.releaseLock();
  }
}
