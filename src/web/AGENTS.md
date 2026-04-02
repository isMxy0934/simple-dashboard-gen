# Web Layer

`src/web/` contains frontend product features.

Structure:

- `src/web/<feature>/ui`: React components for that feature
- `src/web/<feature>/hooks`: feature orchestration hooks
- `src/web/<feature>/api`: browser-side API/storage adapters
- `src/web/<feature>/state`: feature-local state transforms and selectors
- `src/web/shared/*`: cross-feature frontend helpers, contexts, and shared styles

Rules:

- Keep code feature-scoped.
- Put browser `fetch`, `localStorage`, and preview-link IO in `api/`.
- Put React composition and orchestration in `hooks/`.
- Put feature-specific editing logic in `state/`.
- Put cross-feature frontend shared code in `src/web/shared/`.

Forbidden dependencies:

- Do not import from `src/server/`.
- Do not import from another feature unless it is a deliberate shared module under `src/web/shared/`, `src/domain/`, `src/contracts/`, or `src/shared/`.
