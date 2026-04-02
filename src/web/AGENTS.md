# Web Layer

`src/web/` contains frontend product features.

Structure:

- `src/web/<feature>/ui`: React components for that feature
- `src/web/<feature>/hooks`: feature orchestration hooks
- `src/web/<feature>/api`: browser-side API/storage adapters
- `src/web/<feature>/state`: feature-local state transforms and selectors
- `src/web/i18n/*`: frontend locale system, messages, and React i18n context
- `src/web/api/*`: cross-feature browser-side API/cache helpers
- `src/web/utils/*`: small cross-feature frontend helpers
- `src/web/styles/*`: shared frontend styles

Rules:

- Keep code feature-scoped.
- Put browser `fetch`, `localStorage`, and preview-link IO in `api/`.
- Put React composition and orchestration in `hooks/`.
- Put feature-specific editing logic in `state/`.
- Put locale and translation code in `src/web/i18n/`.
- Put cross-feature browser API helpers in `src/web/api/`.
- Put small cross-feature helpers in `src/web/utils/`.

Forbidden dependencies:

- Do not import from `src/server/`.
- Do not import from another feature unless it is a deliberate shared module under `src/web/i18n/`, `src/web/api/`, `src/web/utils/`, `src/web/styles/`, `src/domain/`, or `src/contracts/`.
