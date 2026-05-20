import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type { AuthoringScopeInput } from "../src/ai/authoring/runtime/capability-scope.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const {
  inferAuthoringIntentFromText,
  resolveAuthoringIntentFromText,
} = await import("../src/ai/authoring/runtime/intent.ts");
const { computeAuthoringScope } = await import(
  "../src/ai/authoring/runtime/capability-scope.ts"
);

function makeScopeInput(
  text: string,
  explicitIntent: "explore" | "author" | null,
): AuthoringScopeInput {
  return {
    dashboard: {
      id: "dash-1",
      name: "Testing Dashboard",
      views: [],
      datasources: [],
      checksSummary: { ok: 0, warning: 0, error: 0 },
    },
    conversation: {
      latestUserText: text,
      latestDraftOutput: null,
      approvalState: "none",
    },
    focusedViewId: null,
    stepHistoryInTurn: [],
    skills: [],
    intentSignal: explicitIntent,
    lockedProfile: null,
  };
}

test("intent inference keeps data discovery in explore mode", () => {
  assert.equal(inferAuthoringIntentFromText("先帮我看看有哪些可用数据"), "explore");
});

test("intent inference treats soft visualization requests as authoring", () => {
  assert.equal(inferAuthoringIntentFromText("我们先看看周趋势吧"), "author");
});

test("server-side intent resolution promotes mistaken explore retry to authoring", () => {
  assert.equal(
    resolveAuthoringIntentFromText("为什么执行失败了 重新执行吧", "explore"),
    "author",
  );
});

test("server-side intent resolution keeps missing intent default as explore", () => {
  assert.equal(resolveAuthoringIntentFromText("hello", null), "explore");
});

test("intent inference keeps pure failure questions in explore mode", () => {
  assert.equal(inferAuthoringIntentFromText("为什么执行失败了"), "explore");
});

test("scope computation exposes authoring tools for soft visualization requests", () => {
  const scope = computeAuthoringScope(
    makeScopeInput("我们先看看周趋势吧", "explore"),
  );

  assert.equal(scope.profile, "author-dashboard");
  assert.ok(scope.allowedTools.includes("stageChart"));
  assert.ok(scope.allowedTools.includes("runCheck"));
});
