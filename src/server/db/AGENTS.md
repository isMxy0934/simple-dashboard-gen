# Server DB

Rules:

- Phase A startup order is config load, `ensureCloudAuthoringSchema`, then DB migration runner.
- New DDL must be added as `src/server/db/migrations/{seq}_{name}.sql`.
- Do not add new `create table`, `alter table`, or `do $$` blocks to `ensureCloudAuthoringSchema` during Phase A.
- Editing an already-applied migration is forbidden; add a new migration instead.
