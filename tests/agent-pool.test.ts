import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------
const {
  getAuthoringAgentPoolEntry,
  registerAuthoringAgentPoolEntry,
  evictAuthoringAgentPoolEntry,
  hasAuthoringAgentPoolEntry,
} = await import("../src/server/authoring/agent-pool.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStubSession() {
  return {
    piAgent: null,
    setTurnConfig: () => {},
    startTurn: async () => {
      throw new Error("not implemented");
    },
  } as never;
}

// Each test gets a unique sessionId so the shared globalThis pool doesn't
// bleed between tests.
let idCounter = 0;
function uniqueId(): string {
  return `test-session-${Date.now()}-${++idCounter}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("pool miss returns null", () => {
  const result = getAuthoringAgentPoolEntry(uniqueId());
  assert.equal(result, null);
});

test("hasAuthoringAgentPoolEntry returns false for unknown session", () => {
  assert.equal(hasAuthoringAgentPoolEntry(uniqueId()), false);
});

test("registerAuthoringAgentPoolEntry stores session and has returns true", () => {
  const id = uniqueId();
  const session = makeStubSession();
  const entry = registerAuthoringAgentPoolEntry(id, session);

  assert.equal(entry.sessionId, id);
  assert.equal(entry.session, session);
  assert.equal(hasAuthoringAgentPoolEntry(id), true);
});

test("getAuthoringAgentPoolEntry returns entry after registration", () => {
  const id = uniqueId();
  const session = makeStubSession();
  registerAuthoringAgentPoolEntry(id, session);

  const found = getAuthoringAgentPoolEntry(id);
  assert.ok(found !== null);
  assert.equal(found.session, session);
  assert.equal(found.sessionId, id);
});

test("getAuthoringAgentPoolEntry touches lastUsedAt", async () => {
  const id = uniqueId();
  registerAuthoringAgentPoolEntry(id, makeStubSession());

  const before = getAuthoringAgentPoolEntry(id)!.lastUsedAt;
  // Small sleep to ensure timestamp advances.
  await new Promise((r) => setTimeout(r, 5));
  const after = getAuthoringAgentPoolEntry(id)!.lastUsedAt;

  assert.ok(after >= before, "lastUsedAt should be monotonically non-decreasing");
});

test("evictAuthoringAgentPoolEntry removes the entry", () => {
  const id = uniqueId();
  registerAuthoringAgentPoolEntry(id, makeStubSession());
  assert.equal(hasAuthoringAgentPoolEntry(id), true);

  evictAuthoringAgentPoolEntry(id);
  assert.equal(hasAuthoringAgentPoolEntry(id), false);
  assert.equal(getAuthoringAgentPoolEntry(id), null);
});

test("evictAuthoringAgentPoolEntry on unknown id is a no-op", () => {
  assert.doesNotThrow(() => evictAuthoringAgentPoolEntry(uniqueId()));
});

test("registering the same sessionId twice overwrites the old entry", () => {
  const id = uniqueId();
  const session1 = makeStubSession();
  const session2 = makeStubSession();

  registerAuthoringAgentPoolEntry(id, session1);
  registerAuthoringAgentPoolEntry(id, session2);

  const entry = getAuthoringAgentPoolEntry(id);
  assert.ok(entry !== null);
  assert.equal(entry.session, session2, "second registration should win");
});

test("pool supports multiple independent sessions", () => {
  const idA = uniqueId();
  const idB = uniqueId();
  const sessionA = makeStubSession();
  const sessionB = makeStubSession();

  registerAuthoringAgentPoolEntry(idA, sessionA);
  registerAuthoringAgentPoolEntry(idB, sessionB);

  assert.equal(getAuthoringAgentPoolEntry(idA)?.session, sessionA);
  assert.equal(getAuthoringAgentPoolEntry(idB)?.session, sessionB);

  evictAuthoringAgentPoolEntry(idA);
  assert.equal(hasAuthoringAgentPoolEntry(idA), false);
  assert.equal(hasAuthoringAgentPoolEntry(idB), true);
});
