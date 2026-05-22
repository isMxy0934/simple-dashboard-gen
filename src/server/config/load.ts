import "server-only";

import { z } from "zod";

const secretSchema = z.object({
  kid: z.string().min(1),
  secret: z.string().min(32),
});

const sessionSecretsSchema = z.object({
  current: secretSchema,
  previous: z.array(secretSchema).default([]),
});

const thinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);

function jsonObject<T extends z.ZodType>(schema: T) {
  return z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Invalid JSON",
        });
        return z.NEVER;
      }
    })
    .pipe(schema);
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const positiveInt = (defaultValue: number) => z.coerce.number().int().positive().default(defaultValue);

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalThinkingLevel = z.preprocess(
  (value) => (value === "" ? undefined : value),
  thinkingLevelSchema.optional(),
);

const configSchema = z.object({
  SDS_SESSION_SECRETS: jsonObject(sessionSecretsSchema),
  SDS_SESSION_TTL_DAYS: positiveInt(7),
  SDS_SESSION_REFRESH_GRACE_HOURS: positiveInt(24),
  SDS_ALLOWED_ORIGINS: z.string().transform(csv),
  SDS_DATABASE_URL: z.string().min(1),
  SDS_LLM_PROVIDER: optionalNonEmptyString,
  SDS_LLM_MODEL: optionalNonEmptyString,
  SDS_LLM_THINKING_LEVEL: optionalThinkingLevel,
  PI_PROVIDER: optionalNonEmptyString,
  PI_MODEL: optionalNonEmptyString,
  PI_THINKING_LEVEL: optionalThinkingLevel,
  SDS_QUOTA_VIEWS_PER_DASHBOARD: positiveInt(50),
  SDS_QUOTA_QUERIES_PER_DASHBOARD: positiveInt(100),
  SDS_QUOTA_DOCUMENT_SIZE_MB: positiveInt(2),
  SDS_QUOTA_QUERY_ROWS: positiveInt(10000),
  SDS_QUOTA_QUERY_BYTES: positiveInt(5242880),
  SDS_QUOTA_BATCH_SIZE: positiveInt(20),
  SDS_QUOTA_MODEL_INPUT_TOKENS: positiveInt(32000),
  SDS_QUOTA_MODEL_OUTPUT_TOKENS: positiveInt(8000),
  SDS_QUOTA_TRACE_FILE_MB: positiveInt(50),
  SDS_QUOTA_SESSIONS_PER_WORKSPACE: positiveInt(50),
  SDS_QUOTA_DASHBOARDS_PER_WORKSPACE: positiveInt(200),
  SDS_QUOTA_STORAGE_GB: positiveInt(10),
  SDS_OBSERVABILITY_SINKS: z.string().default("jsonl,ai-trace").transform(csv),
  SDS_SENTRY_DSN: z.string().optional(),
  SDS_OTEL_ENDPOINT: z.string().optional(),
});

const llmConfigEnvSchema = z.object({
  SDS_LLM_PROVIDER: optionalNonEmptyString,
  SDS_LLM_MODEL: optionalNonEmptyString,
  SDS_LLM_THINKING_LEVEL: optionalThinkingLevel,
  PI_PROVIDER: optionalNonEmptyString,
  PI_MODEL: optionalNonEmptyString,
  PI_THINKING_LEVEL: optionalThinkingLevel,
});

export type AppConfig = z.infer<typeof configSchema>;

export type LlmConfig = {
  provider?: string;
  model?: string;
  thinkingLevel?: z.infer<typeof thinkingLevelSchema>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(env);
}

export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const config = llmConfigEnvSchema.parse(env);

  return {
    provider: config.SDS_LLM_PROVIDER ?? config.PI_PROVIDER,
    model: config.SDS_LLM_MODEL ?? config.PI_MODEL,
    thinkingLevel: config.SDS_LLM_THINKING_LEVEL ?? config.PI_THINKING_LEVEL,
  };
}
