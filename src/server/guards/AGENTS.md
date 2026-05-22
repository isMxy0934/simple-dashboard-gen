# Guard Layer

Rules:

- Quota and rate-limit checks live in this directory.
- Guards throw `ApiError` with stable machine codes when enforcement is implemented.
- Guard modules must not import from `src/web/`.
