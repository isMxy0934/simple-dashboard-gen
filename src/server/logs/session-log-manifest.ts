import "server-only";

import { createHash } from "crypto";
import { appendFile, mkdir } from "fs/promises";
import path from "path";
import type { TraceManifestEntry } from "@/ai/shared/tracing";

const SESSION_LOG_DIR = path.join(process.cwd(), "logs", "sessions");
const SESSION_LOG_MANIFEST_PATH = path.join(SESSION_LOG_DIR, "manifest.jsonl");

export async function appendTraceManifestEntry(entry: TraceManifestEntry) {
  await mkdir(SESSION_LOG_DIR, { recursive: true });
  await appendFile(SESSION_LOG_MANIFEST_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

function resolveTraceFileStem(sessionId: string) {
  return createHash("sha256").update(sessionId).digest("hex");
}

export function resolveTraceFileName(sessionId: string) {
  return `${resolveTraceFileStem(sessionId)}.jsonl`;
}

export function resolveAiTraceFileName(sessionId: string) {
  return `${resolveTraceFileStem(sessionId)}.ai.jsonl`;
}

export function resolveTraceFilePath(sessionId: string) {
  return path.join(SESSION_LOG_DIR, resolveTraceFileName(sessionId));
}

export function resolveAiTraceFilePath(sessionId: string) {
  return path.join(SESSION_LOG_DIR, resolveAiTraceFileName(sessionId));
}
