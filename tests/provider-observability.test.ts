import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { summarizeProviderPayload } = await import(
  "../src/ai/authoring/agent/provider-observability.ts"
);

test("provider payload summary records DeepSeek thinking parameters", () => {
  const summary = summarizeProviderPayload({
    payload: {
      model: "deepseek-v4-pro",
      messages: [],
      tools: [],
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    },
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    api: "openai-completions",
    thinkingLevel: "high",
  });

  assert.equal(summary.thinkingParam, "enabled");
  assert.equal(summary.reasoningEffort, "high");
  assert.equal(summary.enableThinking, null);
});

test("provider payload summary records OpenAI-compatible reasoning effort", () => {
  const summary = summarizeProviderPayload({
    payload: {
      model: "o4-mini",
      messages: [],
      tools: [],
      reasoning_effort: "medium",
    },
    provider: "openai",
    modelId: "o4-mini",
    api: "openai-completions",
    thinkingLevel: "medium",
  });

  assert.equal(summary.thinkingParam, null);
  assert.equal(summary.reasoningEffort, "medium");
  assert.equal(summary.enableThinking, null);
});
