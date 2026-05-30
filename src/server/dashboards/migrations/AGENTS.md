# Dashboard Document Migrations

`src/server/dashboards/migrations/` owns deterministic migrations for persisted
`DashboardDocument` JSON.

Rules:

- Keep top-level document schema version and dashboard spec schema version as
  separate concepts.
- Migrators must be deterministic and side-effect free.
- Keep real v0.3 fixtures under `__fixtures__/v0.3/`.
- Do not remove `dashboard_spec.schema_version` during v1.0 migration.
- Migrators may normalize missing semantic view intent, query definitions, and
  bindings, but must not call AI tools, datasource execution, or renderer browser
  code.
