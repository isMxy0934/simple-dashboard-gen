# Server Config

Rules:

- Declare app `SDS_*` keys in `load.ts`.
- Keep `PI_PROVIDER`, `PI_MODEL`, `PI_THINKING_LEVEL` optional fallback while pi-ai runtime is in use.
- Do not place provider auth keys such as `OPENAI_API_KEY` or `DEEPSEEK_API_KEY` in Zod schema.
- Document provider auth passthrough keys in `provider-auth-env-allowlist.ts`.
- Do not fail startup because an unused provider auth key is missing.
