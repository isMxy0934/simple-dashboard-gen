import { createHash } from "crypto";
import path from "path";

const SESSION_LOG_DIR = path.join(process.cwd(), "logs", "sessions");

function hashLogKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function resolveDashboardFileStem(dashboardId?: string | null) {
  return hashLogKey(dashboardId?.trim() || "dashboardless");
}

function resolveSessionFileStem(sessionId: string) {
  return hashLogKey(sessionId);
}

export function resolveDashboardLogDirName(dashboardId?: string | null) {
  return `dashboard-${resolveDashboardFileStem(dashboardId)}`;
}

export function resolveSessionLogDirName(sessionId: string) {
  return `session-${resolveSessionFileStem(sessionId)}`;
}

export function resolveDashboardLogDirPath(dashboardId?: string | null) {
  return path.join(SESSION_LOG_DIR, resolveDashboardLogDirName(dashboardId));
}

export function resolveSessionLogDirPath(input: {
  dashboardId?: string | null;
  sessionId: string;
}) {
  return path.join(
    resolveDashboardLogDirPath(input.dashboardId),
    resolveSessionLogDirName(input.sessionId),
  );
}

export function resolveTraceFileName() {
  return "trace.jsonl";
}

export function resolveAiTraceFileName() {
  return "trace.ai.jsonl";
}

export function resolveAgentLedgerFileName() {
  return "agent-events.jsonl";
}

export function resolveTraceFilePath(input: {
  dashboardId?: string | null;
  sessionId: string;
}) {
  return path.join(resolveSessionLogDirPath(input), resolveTraceFileName());
}

export function resolveAiTraceFilePath(input: {
  dashboardId?: string | null;
  sessionId: string;
}) {
  return path.join(resolveSessionLogDirPath(input), resolveAiTraceFileName());
}

export function resolveAgentLedgerFilePath(input: {
  dashboardId?: string | null;
  sessionId: string;
}) {
  return path.join(resolveSessionLogDirPath(input), resolveAgentLedgerFileName());
}

export function resolveTraceFileManifestRef(input: {
  dashboardId?: string | null;
  sessionId: string;
}) {
  return path.join(
    resolveSessionLogDirName(input.sessionId),
    resolveTraceFileName(),
  );
}

export function resolveAiTraceFileManifestRef(input: {
  dashboardId?: string | null;
  sessionId: string;
}) {
  return path.join(
    resolveSessionLogDirName(input.sessionId),
    resolveAiTraceFileName(),
  );
}

export function resolveAgentLedgerFileManifestRef(input: {
  dashboardId?: string | null;
  sessionId: string;
}) {
  return path.join(
    resolveSessionLogDirName(input.sessionId),
    resolveAgentLedgerFileName(),
  );
}
