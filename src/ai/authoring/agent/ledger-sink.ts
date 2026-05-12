import type { AuthoringDependencies } from "@/ai/authoring/runtime/dependencies";
import {
  writeAuthoringLedgerEvent,
  writeAuthoringTrace,
} from "@/ai/authoring/runtime/dependencies";
import type { AuthoringAgentLedgerEvent } from "@/ai/authoring/agent/ledger";

/** Per-turn identifiers and timestamps consumed by ledger builders. */
export interface AuthoringLedgerRunContext {
  runId: string;
  startedAtMs: number;
  sessionId?: string;
  dashboardId?: string | null;
  turnId?: string;
}

/**
 * Centralises all ledger and trace writes for an authoring agent run.
 * Holds a monotonically-increasing sequence counter and per-turn run context.
 * The run context is updated at the start of each turn via `setRunContext`.
 */
export class AuthoringLedgerSink {
  private seq = 0;
  private ctx: AuthoringLedgerRunContext;
  private readonly deps: AuthoringDependencies | undefined;

  constructor(
    deps: AuthoringDependencies | undefined,
    initialCtx: AuthoringLedgerRunContext,
  ) {
    this.deps = deps;
    this.ctx = { ...initialCtx };
  }

  /** Update identifiers for a new turn before any ledger writes. */
  setRunContext(ctx: AuthoringLedgerRunContext): void {
    this.ctx = { ...ctx };
  }

  getRunContext(): Readonly<AuthoringLedgerRunContext> {
    return this.ctx;
  }

  /** Returns the next monotonically-increasing sequence number. */
  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  async write(event: AuthoringAgentLedgerEvent): Promise<void> {
    await writeAuthoringLedgerEvent(this.deps, event);
  }

  async trace(scope: string, event: string, payload?: unknown): Promise<void> {
    await writeAuthoringTrace(this.deps, scope, event, payload);
  }
}
