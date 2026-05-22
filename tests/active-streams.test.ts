import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { releaseAuthoringStreamSlot } = await import(
  "../src/server/authoring/active-streams.ts"
);

function installFakePool(query: (sql: string, params?: unknown[]) => Promise<unknown>) {
  const globals = globalThis as typeof globalThis & {
    __cloudAuthoringSchemaReady?: Promise<void>;
    __cloudAuthoringMigrationsReady?: Promise<void>;
    __dashboardPgPool?: unknown;
  };
  const previousSchemaReady = globals.__cloudAuthoringSchemaReady;
  const previousMigrationsReady = globals.__cloudAuthoringMigrationsReady;
  const previousPool = globals.__dashboardPgPool;
  globals.__cloudAuthoringSchemaReady = Promise.resolve();
  globals.__cloudAuthoringMigrationsReady = Promise.resolve();
  globals.__dashboardPgPool = { query } as never;
  return () => {
    globals.__cloudAuthoringSchemaReady = previousSchemaReady;
    globals.__cloudAuthoringMigrationsReady = previousMigrationsReady;
    globals.__dashboardPgPool = previousPool;
  };
}

test("releaseAuthoringStreamSlot deletes only the reserved owner lease", async () => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const restore = installFakePool(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [] };
  });
  try {
    await releaseAuthoringStreamSlot({
      sessionId: "sess-release",
      dashboardId: "dash-release",
      turnId: "turn-release",
      ownerId: "owner-release",
    });
  } finally {
    restore();
  }

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /delete from authoring_stream_leases/);
  assert.deepEqual(queries[0].params, ["sess-release", "owner-release"]);
});

test("releaseAuthoringStreamSlot does not throw when lease deletion fails", async () => {
  const restore = installFakePool(async () => {
    throw new Error("database unavailable");
  });
  try {
    await assert.doesNotReject(() =>
      releaseAuthoringStreamSlot({
        sessionId: "sess-release-error",
        dashboardId: "dash-release-error",
        turnId: "turn-release-error",
        ownerId: "owner-release-error",
      }),
    );
  } finally {
    restore();
  }
});
