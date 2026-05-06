import { createHash } from "node:crypto";

const DEFAULT_WALL_CLOCK_MS = 60_000;
const DEFAULT_REASONING_WALL_CLOCK_MS = 180_000;

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveAuthoringWallClockTimeout(runtime: {
  thinkingLevel: string;
}): number {
  const envMs = parsePositiveInteger(process.env.AUTHORING_AGENT_WALL_CLOCK_MS);
  if (envMs) {
    return envMs;
  }

  return runtime.thinkingLevel === "off"
    ? DEFAULT_WALL_CLOCK_MS
    : DEFAULT_REASONING_WALL_CLOCK_MS;
}

export function createAuthoringProviderSessionId(
  sessionId: string | undefined,
): string | undefined {
  if (!sessionId) {
    return undefined;
  }
  if (sessionId.length <= 64) {
    return sessionId;
  }
  return `authoring-${createHash("sha256").update(sessionId).digest("hex").slice(0, 54)}`;
}
