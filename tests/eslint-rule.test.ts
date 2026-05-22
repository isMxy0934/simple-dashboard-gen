import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";

// @ts-expect-error Local ESLint rule is a JavaScript module imported by Node at runtime.
const ruleModule = await import("../eslint-rules/no-identity-in-request.js");

test("no-identity-in-request rule metadata is available", () => {
  assert.equal(ruleModule.default.meta.type, "problem");
  assert.equal(
    ruleModule.default.meta.messages.identityFromBody,
    "Do not read identity from request body in API routes; use requireServerSession(req).",
  );
  assert.equal(
    ruleModule.default.meta.messages.identityFromQuery,
    "Do not read identity from query string in API routes; use requireServerSession(req).",
  );
});

function lintApiRoute(code: string) {
  const linter = new Linter();

  return linter.verify(
    code,
    [
      {
        files: ["src/app/api/**/*.ts"],
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
        },
        plugins: {
          sds: {
            rules: {
              "no-identity-in-request": ruleModule.default,
            },
          },
        },
        rules: {
          "sds/no-identity-in-request": "error",
        },
      },
    ],
    { filename: "src/app/api/example/route.ts" },
  );
}

test("no-identity-in-request reports identity reads from likely request body objects", () => {
  const messages = lintApiRoute("const workspaceId = payload.workspaceId;");

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.messageId, "identityFromBody");
});

test("no-identity-in-request reports identity reads from query strings", () => {
  const messages = lintApiRoute('const userId = searchParams.get("userId");');

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.messageId, "identityFromQuery");
});

test("no-identity-in-request reports identity reads from URL search params", () => {
  const messages = lintApiRoute('const workspaceId = url.searchParams.get("workspaceId");');

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.messageId, "identityFromQuery");
});

test("no-identity-in-request reports identity reads from inline URL search params", () => {
  const messages = lintApiRoute(
    'const userId = new URL(request.url).searchParams.get("userId");',
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.messageId, "identityFromQuery");
});

test("no-identity-in-request reports computed identity reads from likely request body objects", () => {
  const messages = lintApiRoute('const userId = payload["userId"];');

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.messageId, "identityFromBody");
});

test("no-identity-in-request ignores computed variable reads from likely request body objects", () => {
  const messages = lintApiRoute("const userId = payload[userId];");

  assert.equal(messages.length, 0);
});

test("no-identity-in-request reports destructured identity reads from likely request body objects", () => {
  const messages = lintApiRoute("const { workspaceId } = payload;");

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.messageId, "identityFromBody");
});

test("no-identity-in-request ignores identity reads from server sessions", () => {
  const messages = lintApiRoute(`
    const session = await requireServerSession(req);
    session.userId;
  `);

  assert.equal(messages.length, 0);
});

test("no-identity-in-request ignores identity reads from nested context data", () => {
  const messages = lintApiRoute("context.data.userId;");

  assert.equal(messages.length, 0);
});
