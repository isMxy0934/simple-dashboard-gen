import "server-only";

import type { AuthoringAgentSession } from "@/ai/authoring/agent/session";

declare global {
  // eslint-disable-next-line no-var
  var __authoringAgentPool: Map<string, AuthoringAgentPoolEntry> | undefined;
}

export interface AuthoringAgentPoolEntry {
  session: AuthoringAgentSession;
  sessionId: string;
  lastUsedAt: number;
}

/** Evict pool entries idle for longer than this. */
const POOL_TTL_MS = 30 * 60 * 1000;

function getPool(): Map<string, AuthoringAgentPoolEntry> {
  if (!globalThis.__authoringAgentPool) {
    globalThis.__authoringAgentPool = new Map();
    const timer = setInterval(evictStalePoolEntries, 5 * 60 * 1000);
    // Don't keep the process alive just for eviction.
    timer.unref?.();
  }
  return globalThis.__authoringAgentPool;
}

function evictStalePoolEntries(): void {
  const pool = getPool();
  const now = Date.now();
  for (const [id, entry] of pool) {
    if (now - entry.lastUsedAt > POOL_TTL_MS) {
      pool.delete(id);
    }
  }
}

/**
 * Look up a live session for the given sessionId without creating one.
 * Touches `lastUsedAt` on hit.
 */
export function getAuthoringAgentPoolEntry(
  sessionId: string,
): AuthoringAgentPoolEntry | null {
  const pool = getPool();
  const entry = pool.get(sessionId) ?? null;
  if (entry) {
    entry.lastUsedAt = Date.now();
  }
  return entry;
}

/**
 * Register a newly-created session in the pool.
 * Returns the pool entry for convenience.
 */
export function registerAuthoringAgentPoolEntry(
  sessionId: string,
  session: AuthoringAgentSession,
): AuthoringAgentPoolEntry {
  const pool = getPool();
  const entry: AuthoringAgentPoolEntry = {
    session,
    sessionId,
    lastUsedAt: Date.now(),
  };
  pool.set(sessionId, entry);
  return entry;
}

/** Remove a session from the pool (e.g. on unrecoverable error). */
export function evictAuthoringAgentPoolEntry(sessionId: string): void {
  getPool().delete(sessionId);
}

/** Check whether a live session exists in the pool without touching it. */
export function hasAuthoringAgentPoolEntry(sessionId: string): boolean {
  return getPool().has(sessionId);
}
