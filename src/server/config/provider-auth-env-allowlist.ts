export const PROVIDER_AUTH_ENV_ALLOWLIST = [
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

export type ProviderAuthEnvKey = (typeof PROVIDER_AUTH_ENV_ALLOWLIST)[number];
