export interface TraceEvent {
  ts: string;
  seq: number;
  sessionId: string;
  dashboardId: string | null;
  turnId: string | null;
  scope: string;
  event: string;
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
