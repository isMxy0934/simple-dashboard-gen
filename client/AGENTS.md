# Client Layer

`client/` contains frontend product features.

Structure:

- `client/<feature>/ui`: React components for that feature
- `client/<feature>/hooks`: feature orchestration hooks
- `client/<feature>/api`: browser-side API/storage adapters
- `client/<feature>/state`: feature-local state transforms and selectors
- `client/shared/api`: browser-side shared helpers reused by multiple client features

Rules:

- Keep code feature-scoped.
- Put browser `fetch`, `localStorage`, and preview-link IO in `api/`.
- Put React composition and orchestration in `hooks/`.
- Put feature-specific editing logic in `state/`.
- Put cross-feature presentational pieces in `components/`, not here.

Forbidden dependencies:

- Do not import from `server/`.
- Do not import from another feature unless it is a deliberate shared module under `components/`, `domain/`, `contracts/`, or `shared/`.
