# AI Providers

`src/ai/providers/` owns provider runtime adapters and registry-facing model
integration.

Rules:

- Preserve existing `PiModelRuntime` behavior.
- Do not hardcode provider enums that exclude registry providers such as DeepSeek.
- Provider auth keys are read by pi-ai AuthStorage through process env and are
  documented in `src/server/config/provider-auth-env-allowlist.ts`.
- Contract tests should use `MockProvider` unless they explicitly verify pi-ai
  registry behavior.
- Provider adapters must not know dashboard tool semantics; they receive the
  scoped tool surface assembled by `src/ai/authoring/`.
