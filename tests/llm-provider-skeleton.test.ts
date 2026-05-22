import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { MockProvider } = await import("../src/ai/providers/mock-provider.ts");

test("MockProvider returns deterministic text", async () => {
  const provider = new MockProvider("mock response");
  const result = await provider.generateText({ messages: [{ role: "user", content: "hello" }] });

  assert.deepEqual(result, {
    provider: "mock",
    model: "mock",
    text: "mock response",
  });
});
