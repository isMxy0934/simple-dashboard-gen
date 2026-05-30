# Server DB

`src/server/db/` owns database connection helpers, migration execution, and SQL
schema files.

Rules:

- Startup order is config load, `ensureCloudAuthoringSchema`, then DB migration
  runner.
- New DDL must be added as `src/server/db/migrations/{seq}_{name}.sql`.
- Do not add new `create table`, `alter table`, or `do $$` blocks to
  `ensureCloudAuthoringSchema`; use a migration.
- Editing an already-applied migration is forbidden; add a new migration instead.
- Keep DB helpers server-only and free of web imports.
- Persist dashboard state through repository/service code; DB helpers should not
  know authoring tool semantics.
