# Web Shared Layer

`src/web/shared/` contains frontend-only shared code reused across web features.

Good fits:

- i18n React context
- browser-side shared API/cache helpers
- shared frontend styles
- small UI-adjacent helpers with no single feature owner

Rules:

- Keep this layer browser-safe and React-safe.
- Do not put feature flows here.
- Do not put server-only code here.
- If code is not frontend-specific, move it to `src/shared/`.
