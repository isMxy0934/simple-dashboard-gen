import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { resolveProviderModelConfig } = await import(
  "../src/ai/providers/model-config.ts"
);

type EnvSnapshot = Partial<Record<string, string>>;

const providerEnvKeys = [
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_API_MODE",
  "OPENAI_FORCE_REASONING",
  "OPENAI_DEEPSEEK_THINKING",
  "DEEPSEEK_THINKING",
] as const;

function snapshotEnv(): EnvSnapshot {
  return Object.fromEntries(
    providerEnvKeys.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key] as string]],
    ),
  );
}

function restoreEnv(snapshot: EnvSnapshot) {
  for (const key of providerEnvKeys) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

function withProviderEnv<T>(env: EnvSnapshot, fn: () => T): T {
  const previous = snapshotEnv();
  try {
    for (const key of providerEnvKeys) {
      delete process.env[key];
    }
    Object.assign(process.env, env);
    return fn();
  } finally {
    restoreEnv(previous);
  }
}

test("DeepSeek v4 resolves to pi provider with thinking enabled by default", () => {
  withProviderEnv(
    {
      OPENAI_MODEL: "deepseek-v4-pro",
      OPENAI_BASE_URL: "https://api.deepseek.com/v1",
      OPENAI_API_MODE: "chat",
    },
    () => {
      const config = resolveProviderModelConfig();
      assert.equal(config.providerKind, "deepseek");
      assert.equal(config.model.provider, "deepseek");
      assert.equal(config.modelId, "deepseek-v4-pro");
      assert.equal(config.thinkingLevel, "medium");
      assert.equal(config.supportsTemperature, false);
    },
  );
});

test("OpenAI dated snapshot ids normalize to pi model ids", () => {
  withProviderEnv(
    {
      OPENAI_MODEL: "gpt-5.4-mini-2026-03-17",
    },
    () => {
      const config = resolveProviderModelConfig();
      assert.equal(config.providerKind, "openai");
      assert.equal(config.modelId, "gpt-5.4-mini");
      assert.equal(config.model.provider, "openai");
      assert.equal(config.model.api, "openai-responses");
      assert.equal(config.thinkingLevel, "medium");
    },
  );
});

test("DeepSeek thinking can be disabled explicitly when the caller opts out", () => {
  withProviderEnv(
    {
      OPENAI_MODEL: "deepseek-v4-pro",
      OPENAI_BASE_URL: "https://api.deepseek.com/v1",
      DEEPSEEK_THINKING: "disabled",
    },
    () => {
      const config = resolveProviderModelConfig();
      assert.equal(config.model.provider, "deepseek");
      assert.equal(config.thinkingLevel, "off");
      assert.equal(config.supportsTemperature, true);
    },
  );
});
