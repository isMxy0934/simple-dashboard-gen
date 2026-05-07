import "server-only";

import { appendFile, mkdir } from "fs/promises";
import type { AuthoringAgentLedgerEvent } from "@/ai/authoring/agent/ledger";
import {
  resolveAgentLedgerFilePath,
  resolveSessionLogDirPath,
} from "@/server/logs/session-log-paths";

declare global {
  var __authoringAgentLedgerWriteQueues:
    | Map<string, Promise<void>>
    | undefined;
}

function getLedgerWriteQueues() {
  if (!globalThis.__authoringAgentLedgerWriteQueues) {
    globalThis.__authoringAgentLedgerWriteQueues = new Map();
  }
  return globalThis.__authoringAgentLedgerWriteQueues;
}

export async function writeAuthoringAgentLedgerEvent(
  event: AuthoringAgentLedgerEvent,
) {
  const sessionId = event.sessionId ?? "unknown";
  const dashboardId = event.dashboardId ?? null;
  const queues = getLedgerWriteQueues();
  const current = queues.get(sessionId) ?? Promise.resolve();
  const next = current
    .catch(() => undefined)
    .then(async () => {
      const pathInput = { dashboardId, sessionId };
      try {
        await mkdir(resolveSessionLogDirPath(pathInput), { recursive: true });
        await appendFile(
          resolveAgentLedgerFilePath(pathInput),
          `${JSON.stringify(event)}\n`,
          "utf8",
        );
      } catch (error) {
        console.error("[authoring-ledger-writer] failed", {
          sessionId,
          dashboardId,
          eventKind: event.kind,
          piEventType: event.piEventType,
          error,
        });
      }
    });

  queues.set(sessionId, next);
  await next;
}
