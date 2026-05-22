export interface TraceEvent {
  ts: string;
  timestamp: string;
  seq: number;
  sessionId: string;
  dashboardId: string | null;
  turnId: string | null;
  requestId: string;
  type: string;
  level: "info" | "warn" | "error";
  status?: "active" | "completed" | "errored";
  scope?: string;
  event?: string;
  payload?: unknown;
}

export interface TraceManifestEntry {
  sessionId: string;
  dashboardId: string | null;
  startedAt: string;
  lastEventAt: string;
  status: "active" | "completed" | "errored";
  traceFile: string;
  aiTraceFile?: string;
}
