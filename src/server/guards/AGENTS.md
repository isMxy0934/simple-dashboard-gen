# Guard Layer

`src/server/guards/` owns quota, rate-limit, and capacity enforcement used by
server services and API routes.

Rules:

- Quota and rate-limit checks live in this directory.
- Guards throw `ApiError` with stable machine codes when enforcement is implemented.
- Guard modules must not import from `src/web/`.
- Enforcement must use session/workspace identity from server auth, not request
  body identity fields.
- Guard failures should be observable without logging provider keys, datasource
  secrets, tokens, or raw credential strings.
