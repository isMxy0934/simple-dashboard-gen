# Dashboard Document Migrations

Rules:

- Keep document schema version and legacy dashboard spec schema version as separate concepts.
- Migrators must be deterministic and side-effect free.
- Keep real v0.3 fixtures under `__fixtures__/v0.3/`.
- Do not remove `dashboard_spec.schema_version` during v1.0 migration.
