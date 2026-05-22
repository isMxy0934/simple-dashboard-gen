import assert from "node:assert/strict";
import test from "node:test";

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
