# AI Providers

Rules:

- Preserve existing `PiModelRuntime` behavior.
- Do not hardcode provider enums that exclude registry providers such as DeepSeek.
- Provider auth keys are read by pi-ai AuthStorage through process env and are documented in `src/server/config/provider-auth-env-allowlist.ts`.
- Contract tests should use `MockProvider` unless they explicitly verify pi-ai registry behavior.
