import "server-only";

import { appendFile, mkdir, rename, stat } from "fs/promises";
import path from "path";
import type { LogSink, ObservabilityEvent } from "../observability";
import type { TraceEvent } from "../types";
import {
  appendTraceManifestEntry,
  resolveAiTraceFileManifestRef,
  resolveSessionLogDirPath,
  resolveTraceFileManifestRef,
  resolveTraceFilePath,
} from "../session-log-manifest";

declare global {
  var __observabilityTraceSequences: Map<string, number> | undefined;
}

function getTraceSequences() {
  if (!globalThis.__observabilityTraceSequences) {
    globalThis.__observabilityTraceSequences = new Map();
  }
  return globalThis.__observabilityTraceSequences;
}

function nextTraceSeq(sessionKey: string) {
  const sequences = getTraceSequences();
  const next = (sequences.get(sessionKey) ?? 0) + 1;
  sequences.set(sessionKey, next);
  return next;
}

function resolveTraceFileLimitBytes(): number {
  const configured = Number.parseInt(process.env.SDS_QUOTA_TRACE_FILE_MB ?? "", 10);
  const mb = Number.isFinite(configured) && configured > 0 ? configured : 50;
  return mb * 1024 * 1024;
}

async function rotateIfNeeded(filePath: string, limitBytes: number): Promise<void> {
  let currentSize = 0;
  try {
    currentSize = (await stat(filePath)).size;
  } catch {
    return;
  }
  if (currentSize < limitBytes) {
    return;
  }

  for (let index = 1; index < 1000; index += 1) {
    const rotatedPath = path.join(
      path.dirname(filePath),
      `trace.${index}.jsonl`,
    );
    try {
      await stat(rotatedPath);
    } catch {
      await rename(filePath, rotatedPath);
      return;
    }
  }
}

export function toTraceEvent(event: ObservabilityEvent, seq: number): TraceEvent {
  return {
    ts: event.timestamp,
    timestamp: event.timestamp,
    seq,
    sessionId: event.sessionId,
    dashboardId: event.dashboardId,
    turnId: event.turnId,
    requestId: event.requestId,
    type: event.type,
    level: event.level,
    status: event.status,
    scope: event.legacyScope,
    event: event.legacyEvent,
    payload: event.payload,
  };
}

export class JsonlFileSink implements LogSink {
  readonly name = "jsonl-file";

  async write(event: ObservabilityEvent): Promise<void> {
    const tracePathInput = {
      dashboardId: event.dashboardId,
      sessionId: event.sessionId,
    };
    const sessionDir = resolveSessionLogDirPath(tracePathInput);
    const traceFile = resolveTraceFilePath(tracePathInput);
    const traceEvent = toTraceEvent(
      event,
      nextTraceSeq(`${event.sessionId}:session`),
    );

    await mkdir(sessionDir, { recursive: true });
    await rotateIfNeeded(traceFile, resolveTraceFileLimitBytes());
    await appendFile(traceFile, `${JSON.stringify(traceEvent)}\n`, "utf8");
    await appendTraceManifestEntry({
      sessionId: event.sessionId,
      dashboardId: event.dashboardId,
      startedAt: event.timestamp,
      lastEventAt: event.timestamp,
      status: event.status ?? "active",
      traceFile: resolveTraceFileManifestRef(tracePathInput),
      aiTraceFile: resolveAiTraceFileManifestRef(tracePathInput),
    });
  }
}
