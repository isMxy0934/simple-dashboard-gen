import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import test from "node:test";

register("../tests/ts-paths-loader.mjs", import.meta.url);

const { validateDashboardDocument } = await import("../src/contracts/validation.ts");

const root = process.cwd();

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

function routeFunctionSource(source: string, method: "PATCH" | "POST" | "PUT"): string {
  const functionStart = source.indexOf(`export async function ${method}`);
  assert.notEqual(functionStart, -1, `route must export ${method}`);

  const nextFunctionStart = source.indexOf("export async function", functionStart + 1);
  return source.slice(
    functionStart,
    nextFunctionStart === -1 ? source.length : nextFunctionStart,
  );
}

function assertAuthBeforeJson(input: {
  source: string;
  method: "PATCH" | "POST" | "PUT";
  routeLabel: string;
}): void {
  const routeSource = routeFunctionSource(input.source, input.method);
  const authIndex = routeSource.indexOf("requireApiSession(");
  const jsonIndex = routeSource.indexOf("request.json()");
  assert.notEqual(authIndex, -1, `${input.routeLabel} must call requireApiSession`);
  assert.notEqual(jsonIndex, -1, `${input.routeLabel} must parse request JSON`);
  assert.ok(
    authIndex < jsonIndex,
    `${input.routeLabel} must authenticate before parsing JSON`,
  );
}

test("migration contract requires top-level dashboard document schema version", () => {
  const result = validateDashboardDocument(
    {
      dashboard_spec: { schema_version: "0.3", views: [] },
      query_defs: [],
      bindings: [],
    },
    "draft",
  );

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (issue) => issue.path === "dashboard_document.schema_version",
    ),
  );
});

test("migration contract keeps legacy spec schema version during document v1", () => {
  const result = validateDashboardDocument(
    {
      schema_version: "1.0",
      dashboard_spec: { schema_version: "1.0", views: [] },
      query_defs: [],
      bindings: [],
    },
    "draft",
  );

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.path === "dashboard_spec.schema_version"),
  );
});

test("identity lint rule is a final error gate", async () => {
  const source = await read("eslint.config.js");
  assert.match(source, /"sds\/no-identity-in-request":\s*"error"/);
});

test("protected mutating routes authenticate before parsing JSON", async () => {
  for (const route of [
    { path: "src/app/api/dashboard/save/route.ts", method: "POST" as const },
    { path: "src/app/api/dashboard/publish/route.ts", method: "POST" as const },
    { path: "src/app/api/datasources/route.ts", method: "POST" as const },
    { path: "src/app/api/datasources/test/route.ts", method: "POST" as const },
    { path: "src/app/api/authoring/session/open/route.ts", method: "POST" as const },
    { path: "src/app/api/authoring/session/save/route.ts", method: "PUT" as const },
    { path: "src/app/api/authoring/checks/route.ts", method: "PUT" as const },
    { path: "src/app/api/authoring/chat/route.ts", method: "POST" as const },
    {
      path: "src/app/api/authoring/chat/[id]/steer/route.ts",
      method: "POST" as const,
    },
    { path: "src/app/api/authoring/task/route.ts", method: "POST" as const },
    { path: "src/app/api/authoring/ui-session/route.ts", method: "PUT" as const },
    { path: "src/app/api/authoring/settings/route.ts", method: "PUT" as const },
    {
      path: "src/app/api/workspace/users/[userId]/role/route.ts",
      method: "PATCH" as const,
    },
  ]) {
    assertAuthBeforeJson({
      source: await read(route.path),
      method: route.method,
      routeLabel: route.path,
    });
  }
});

test("execute batch route authenticates before delegating request parsing", async () => {
  const source = await read("src/app/api/query/execute-batch/route.ts");

  assert.match(
    source,
    /requireApiSession\(request,\s*Permission\.DashboardRead\)/,
  );
  assert.doesNotMatch(source, /workspace_id\s*:\s*[^,}]*request/i);
  assert.doesNotMatch(source, /workspaceId\s*=\s*[^;]*body/i);
});
