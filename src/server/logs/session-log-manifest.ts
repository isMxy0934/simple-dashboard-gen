import "server-only";

import { appendFile, mkdir } from "fs/promises";
import path from "path";
import type { TraceManifestEntry } from "@/ai/shared/tracing";
import { resolveDashboardLogDirPath } from "./session-log-paths";

export {
  resolveAiTraceFileManifestRef,
  resolveAiTraceFileName,
  resolveAiTraceFilePath,
  resolveDashboardLogDirName,
  resolveDashboardLogDirPath,
  resolveSessionLogDirName,
  resolveSessionLogDirPath,
  resolveTraceFileManifestRef,
  resolveTraceFileName,
  resolveTraceFilePath,
} from "./session-log-paths";

export async function appendTraceManifestEntry(entry: TraceManifestEntry) {
  const dashboardDir = resolveDashboardLogDirPath(entry.dashboardId);
  await mkdir(dashboardDir, { recursive: true });
  await appendFile(
    path.join(dashboardDir, "manifest.jsonl"),
    `${JSON.stringify(entry)}\n`,
    "utf8",
  );
}
