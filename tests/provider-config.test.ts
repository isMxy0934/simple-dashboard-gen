import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { AuthStorage, ModelRegistry } = await import(
  "@mariozechner/pi-coding-agent"
);
const { resolvePiModelRuntime } = await import(
  "../src/ai/providers/pi-model-runtime.ts"
);

type EnvSnapshot = Partial<Record<string, string>>;

const providerEnvKeys = [
  "PI_PROVIDER",
  "PI_MODEL",
  "PI_THINKING_LEVEL",
  "SDS_LLM_PROVIDER",
  "SDS_LLM_MODEL",
  "SDS_LLM_THINKING_LEVEL",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
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

async function withProviderEnv<T>(env: EnvSnapshot, fn: () => Promise<T>): Promise<T> {
  const previous = snapshotEnv();
  try {
    for (const key of providerEnvKeys) {
      delete process.env[key];
    }
    Object.assign(process.env, env);
    return await fn();
  } finally {
    restoreEnv(previous);
  }
}

function createServices() {
  const authStorage = AuthStorage.inMemory();
  return {
    authStorage,
    modelRegistry: ModelRegistry.inMemory(authStorage),
  };
}

test("DeepSeek resolves from env through Pi ModelRegistry and AuthStorage", async () => {
  await withProviderEnv({
    PI_PROVIDER: "deepseek",
    PI_MODEL: "deepseek-v4-pro",
    PI_THINKING_LEVEL: "medium",
    DEEPSEEK_API_KEY: "sk-test",
  }, async () => {
    const runtime = await resolvePiModelRuntime({
      services: createServices(),
    });

    assert.equal(runtime.provider, "deepseek");
    assert.equal(runtime.model.provider, "deepseek");
    assert.equal(runtime.modelId, "deepseek-v4-pro");
    assert.equal(runtime.model.api, "openai-completions");
    assert.equal(runtime.model.baseUrl, "https://api.deepseek.com");
    assert.equal(runtime.thinkingLevel, "medium");
  });
});

test("OpenAI resolves from env without Pi settings files", async () => {
  await withProviderEnv({
    PI_PROVIDER: "openai",
    PI_MODEL: "gpt-4.1-mini",
    PI_THINKING_LEVEL: "high",
    OPENAI_API_KEY: "sk-test",
  }, async () => {
    const runtime = await resolvePiModelRuntime({
      services: createServices(),
    });

    assert.equal(runtime.provider, "openai");
    assert.equal(runtime.modelId, "gpt-4.1-mini");
    assert.equal(runtime.thinkingLevel, "off");
  });
});

test("PI_THINKING_LEVEL applies to reasoning models", async () => {
  await withProviderEnv({
    PI_PROVIDER: "deepseek",
    PI_MODEL: "deepseek-v4-flash",
    PI_THINKING_LEVEL: "high",
    DEEPSEEK_API_KEY: "sk-test",
  }, async () => {
    const runtime = await resolvePiModelRuntime({
      services: createServices(),
    });

    assert.equal(runtime.provider, "deepseek");
    assert.equal(runtime.modelId, "deepseek-v4-flash");
    assert.equal(runtime.thinkingLevel, "high");
  });
});

test("SDS_LLM env vars are mapped into the Pi runtime before PI fallbacks", async () => {
  await withProviderEnv({
    SDS_LLM_PROVIDER: "deepseek",
    SDS_LLM_MODEL: "deepseek-v4-flash",
    SDS_LLM_THINKING_LEVEL: "high",
    PI_PROVIDER: "openai",
    PI_MODEL: "gpt-4.1-mini",
    DEEPSEEK_API_KEY: "sk-test",
    OPENAI_API_KEY: "sk-test",
  }, async () => {
    const runtime = await resolvePiModelRuntime({
      services: createServices(),
    });

    assert.equal(runtime.provider, "deepseek");
    assert.equal(runtime.modelId, "deepseek-v4-flash");
    assert.equal(runtime.thinkingLevel, "high");
  });
});

test("missing provider auth fails before the authoring turn starts", async () => {
  await withProviderEnv({
    PI_PROVIDER: "deepseek",
    PI_MODEL: "deepseek-v4-pro",
  }, async () => {
    await assert.rejects(
      () =>
        resolvePiModelRuntime({
          services: createServices(),
        }),
      /api key|auth|credential/i,
    );
  });
});

test("provider and model env vars are required", async () => {
  await withProviderEnv({
    DEEPSEEK_API_KEY: "sk-test",
  }, async () => {
    await assert.rejects(
      () =>
        resolvePiModelRuntime({
          services: createServices(),
        }),
      /PI_PROVIDER and PI_MODEL/,
    );
  });
});
