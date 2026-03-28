import "server-only";

import { appendFile } from "fs/promises";
import path from "path";

const DEBUG_LOG_PATH = path.join(process.cwd(), "debug.log");

/** Set to `1` to log very long strings (e.g. full tool I/O) while testing. */
const DEBUG_LOG_FULL =
  process.env.AUTHORING_DEBUG_LOG_FULL === "1" ||
  process.env.DEBUG_LOG_FULL === "1";

const DEBUG_LOG_MAX_STRING = DEBUG_LOG_FULL ? 500_000 : 4000;

export async function writeDebugLog(
  scope: string,
  event: string,
  payload?: unknown,
) {
  const entry = {
    timestamp: new Date().toISOString(),
    scope,
    event,
    payload: sanitizePayload(payload),
  };

  try {
    await appendFile(DEBUG_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Logging must never break the request flow.
  }
}

function sanitizePayload(payload: unknown): unknown {
  return JSON.parse(
    JSON.stringify(payload, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }

      if (typeof value === "string" && value.length > DEBUG_LOG_MAX_STRING) {
        return `${value.slice(0, DEBUG_LOG_MAX_STRING)}…`;
      }

      return value;
    }),
  );
}
