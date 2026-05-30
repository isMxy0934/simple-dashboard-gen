# Server Config

`src/server/config/` owns server environment loading and provider auth
passthrough documentation.

Rules:

- Declare app `SDS_*` keys in `load.ts`.
- Keep `PI_PROVIDER`, `PI_MODEL`, and `PI_THINKING_LEVEL` optional fallback while
  pi-ai runtime is in use.
- Do not place provider auth keys such as `OPENAI_API_KEY` or `DEEPSEEK_API_KEY`
  in the Zod schema.
- Document provider auth passthrough keys in `provider-auth-env-allowlist.ts`.
- Do not fail startup because an unused provider auth key is missing.
- Keep config loading side-effect-light; schema creation, migrations, and service
  initialization belong in server startup code, not config parsing.
