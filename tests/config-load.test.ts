import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { loadConfig, resolveLlmConfig } = await import("../src/server/config/load.ts");

test("loadConfig parses required SDS env and optional PI fallback keys", () => {
  const config = loadConfig({
    SDS_SESSION_SECRETS: '{"current":{"kid":"k1","secret":"abcdefghijklmnopqrstuvwxyz123456"},"previous":[]}',
    SDS_SESSION_TTL_DAYS: "7",
    SDS_SESSION_REFRESH_GRACE_HOURS: "24",
    SDS_ALLOWED_ORIGINS: "http://localhost:3000,https://example.com",
    SDS_DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
    SDS_QUOTA_VIEWS_PER_DASHBOARD: "50",
    SDS_QUOTA_QUERIES_PER_DASHBOARD: "100",
    SDS_QUOTA_DOCUMENT_SIZE_MB: "2",
    SDS_QUOTA_QUERY_ROWS: "10000",
    SDS_QUOTA_QUERY_BYTES: "5242880",
    SDS_QUOTA_BATCH_SIZE: "20",
    SDS_QUOTA_MODEL_INPUT_TOKENS: "32000",
    SDS_QUOTA_MODEL_OUTPUT_TOKENS: "8000",
    SDS_QUOTA_TRACE_FILE_MB: "50",
    SDS_QUOTA_SESSIONS_PER_WORKSPACE: "50",
    SDS_QUOTA_DASHBOARDS_PER_WORKSPACE: "200",
    SDS_QUOTA_STORAGE_GB: "10",
    SDS_OBSERVABILITY_SINKS: "jsonl,ai-trace",
    SDS_LLM_PROVIDER: "deepseek",
    SDS_LLM_MODEL: "deepseek-chat",
    SDS_LLM_THINKING_LEVEL: "medium",
    PI_PROVIDER: "openai",
    PI_MODEL: "gpt-4.1-mini",
  });

  assert.equal(config.SDS_DATABASE_URL, "postgresql://user:pass@localhost:5432/app");
  assert.deepEqual(config.SDS_ALLOWED_ORIGINS, ["http://localhost:3000", "https://example.com"]);
  assert.equal(config.SDS_QUOTA_BATCH_SIZE, 20);
  assert.equal(config.PI_PROVIDER, "openai");
});

test("resolveLlmConfig prefers SDS_LLM keys over PI fallback", () => {
  const resolved = resolveLlmConfig({
    SDS_LLM_PROVIDER: "deepseek",
    SDS_LLM_MODEL: "deepseek-chat",
    SDS_LLM_THINKING_LEVEL: "high",
    PI_PROVIDER: "openai",
    PI_MODEL: "gpt-4.1-mini",
  });

  assert.deepEqual(resolved, {
    provider: "deepseek",
    model: "deepseek-chat",
    thinkingLevel: "high",
  });
});

test("resolveLlmConfig falls back to PI keys", () => {
  const resolved = resolveLlmConfig({
    PI_PROVIDER: "openai",
    PI_MODEL: "gpt-4.1-mini",
    PI_THINKING_LEVEL: "low",
  });

  assert.deepEqual(resolved, {
    provider: "openai",
    model: "gpt-4.1-mini",
    thinkingLevel: "low",
  });
});
