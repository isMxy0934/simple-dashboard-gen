import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { resolveProviderModelConfig } = await import(
  "../src/ai/providers/model-config.ts"
);
const { prepareDeepSeekThinkingUiMessages } = await import(
  "../src/ai/authoring/messages/deepseek-thinking.ts"
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

test("DeepSeek v4 provider options explicitly enable thinking by default", () => {
  withProviderEnv(
    {
      OPENAI_MODEL: "deepseek-v4-pro",
      OPENAI_BASE_URL: "https://api.deepseek.com/v1",
      OPENAI_API_MODE: "chat",
    },
    () => {
      const config = resolveProviderModelConfig();
      assert.equal(config.providerKind, "deepseek");
      assert.deepEqual(config.providerOptions, {
        deepseek: { thinking: { type: "enabled" } },
      });
      assert.equal(config.supportsTemperature, false);
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
      assert.deepEqual(config.providerOptions, {
        deepseek: { thinking: { type: "disabled" } },
      });
      assert.equal(config.supportsTemperature, true);
    },
  );
});

test("DeepSeek thinking compatibility removes historical raw tool transcripts", () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "有哪些数据" }],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "need schema" },
        { type: "tool-getSchemaByDatasource", state: "output-available" },
        { type: "step-start" },
        { type: "text", text: "可用销售数据包括 sales_weekly_fact。" },
      ],
    },
    {
      id: "u2",
      role: "user",
      parts: [{ type: "text", text: "做 GMV 趋势" }],
    },
  ];

  const prepared = prepareDeepSeekThinkingUiMessages(messages);
  assert.deepEqual(prepared[1].parts, [
    { type: "text", text: "可用销售数据包括 sales_weekly_fact。" },
  ]);
  assert.deepEqual(prepared[2].parts, messages[2].parts);
});
