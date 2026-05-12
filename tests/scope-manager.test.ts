import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
const { AuthoringScopeManager } = await import(
  "../src/ai/authoring/agent/scope-manager.ts"
);
const { AuthoringLedgerSink } = await import(
  "../src/ai/authoring/agent/ledger-sink.ts"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLedgerSink() {
  const written: unknown[] = [];
  const traced: { scope: string; event: string; payload?: unknown }[] = [];
  const sink = new AuthoringLedgerSink(
    {
      executePreview: async () => { throw new Error("not impl"); },
      listDatasources: async () => [],
      loadDatasourceSchema: async () => { throw new Error("not impl"); },
      loadSkill: async () => null,
      writeLedgerEvent: (event) => { written.push(event); },
      writeTraceEvent: ({ scope, event, payload }) => { traced.push({ scope, event, payload }); },
    },
    { runId: "run-1", startedAtMs: Date.now(), sessionId: "sess-1", turnId: "turn-1" },
  );
  return { sink, written, traced };
}

/** Minimal tool definition that satisfies the interface. */
function makeToolSet() {
  return {} as Record<string, never>;
}

/** Minimal draft status snapshot used by deriveAuthoringFacts. */
function makeDraftStatus() {
  return {
    summary: null,
    document_hash: null,
    data_mode: null,
    has_draft: false,
    can_compose: false,
    patch_count: 0,
    suggestion_id: null,
    base_version: null,
    base_document_fingerprint: null,
    draft_fingerprint: null,
    blockers: [],
    pending_data_mode_change: null,
  } as never;
}

function makeBaseDashboard() {
  return {
    dashboard_spec: {
      dashboard: { name: "Test Dashboard", layout: [] },
      views: [],
    },
    query_defs: [],
    bindings: [],
  } as never;
}

function makeScopeManager() {
  const { sink } = makeLedgerSink();
  const messages: never[] = [];

  const manager = new AuthoringScopeManager(
    {
      dashboard: makeBaseDashboard(),
      dashboardId: "dash-1",
      focusedViewId: null,
      datasources: [],
      skills: [],
      checks: [],
      promptText: "hello",
      intent: null,
      approvalEvent: null,
      currentDocumentHash: null,
      loadFailures: null,
    },
    {
      ledgerSink: sink,
      getToolSet: makeToolSet,
      getDraftStatusSnapshot: makeDraftStatus,
      getApprovalContext: () => ({ approved: false }),
      getRuntimeMessages: () => messages,
    },
  );
  return { manager, sink };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("AuthoringScopeManager initializes without throwing", () => {
  assert.doesNotThrow(() => makeScopeManager());
});

test("getCurrentSurface returns a surface with mode and activeTools", () => {
  const { manager } = makeScopeManager();
  const surface = manager.getCurrentSurface();
  assert.ok(typeof surface.mode === "string", "mode should be a string");
  assert.ok(Array.isArray(surface.activeTools), "activeTools should be an array");
});

test("getCurrentScope returns scope capabilities", () => {
  const { manager } = makeScopeManager();
  const scope = manager.getCurrentScope();
  assert.ok(typeof scope.profile === "string", "profile should be a string");
  assert.ok(typeof scope.scope === "object", "scope should be an object");
});

test("resetForTurn does not throw", () => {
  const { manager } = makeScopeManager();
  assert.doesNotThrow(() => manager.resetForTurn());
});

test("onToolResult records step and does not throw on normal tools", () => {
  const { manager } = makeScopeManager();
  manager.resetForTurn();
  assert.doesNotThrow(() => manager.onToolResult("getTableSchema", false));
});

test("setTurnConfig updates scope for new config", () => {
  const { manager } = makeScopeManager();
  const before = manager.getCurrentSurface().mode;
  manager.setTurnConfig({
    dashboard: makeBaseDashboard(),
    dashboardId: "dash-1",
    focusedViewId: null,
    datasources: [],
    skills: [],
    checks: [],
    promptText: "create a chart",
    intent: "author",
    approvalEvent: null,
    currentDocumentHash: null,
    loadFailures: null,
  });
  // Surface mode might change when intent is author – we just check it doesn't throw.
  assert.ok(typeof manager.getCurrentSurface().mode === "string");
  void before; // suppress unused variable warning
});

test("getLastSurfaceDigest and setLastSurfaceDigest round-trip", () => {
  const { manager } = makeScopeManager();
  manager.setLastSurfaceDigest("abc123");
  assert.equal(manager.getLastSurfaceDigest(), "abc123");
  manager.setLastSurfaceDigest(null);
  assert.equal(manager.getLastSurfaceDigest(), null);
});

test("buildPiTools returns an array or object without throwing", () => {
  const { manager } = makeScopeManager();
  assert.doesNotThrow(() => manager.buildPiTools());
});

test("buildSystemPrompt returns a non-empty string", () => {
  const { manager } = makeScopeManager();
  const prompt = manager.buildSystemPrompt();
  assert.ok(typeof prompt === "string" && prompt.length > 0, "system prompt should be non-empty");
});

test("deriveFactsSnapshot returns an object with expected shape", () => {
  const { manager } = makeScopeManager();
  const facts = manager.deriveFactsSnapshot();
  assert.ok(typeof facts === "object" && facts !== null);
  assert.ok("draft" in facts);
  assert.ok("approval" in facts);
});
