# Operations Runbook

## Required Environment

- `SDS_SESSION_SECRETS`: JSON object with `current` and optional `previous` HS256 secrets.
- `SDS_ALLOWED_ORIGINS`: comma-separated allowed browser origins.
- `SDS_DATABASE_URL`: PostgreSQL connection string for app metadata.
- `SDS_LLM_PROVIDER`, `SDS_LLM_MODEL`, `SDS_LLM_THINKING_LEVEL`: preferred LLM runtime settings.
- `SDS_OBSERVABILITY_SINKS`: comma-separated sinks, default `jsonl,ai-trace`.
- `SDS_SENTRY_DSN`: required only when `SDS_OBSERVABILITY_SINKS` contains `sentry`.
- `SDS_OTEL_ENDPOINT`: required only when `SDS_OBSERVABILITY_SINKS` contains `otel`.
- `SDS_QUOTA_*`: quota overrides for dashboard and execution limits.

## Pre-Release Verification

Run:

```bash
npm run typecheck
npm run typecheck:tests
npm test
npm run test:contract -- --coverage
npm run lint
npm run script:check-env
npm run script:check-i18n
npm run build
CI=1 npm run test:e2e -- --reporter=line
npm run check:final
```

## Database Backup

Run before any production migration:

```bash
npm run db:backup -- --output-dir /backup --label pre-migration-final
```

The script writes a compressed `pg_dump -Fc` file and verifies it with `pg_restore --list`.

## Staging Migration Rehearsal

1. Create an empty staging database.
2. Set `SDS_DATABASE_URL` to the empty database.
3. Start the app or run code that calls `ensureCloudAuthoringSchema`.
4. Confirm `schema_migrations` contains `0001` through the latest migration.
5. Run `SDS_DATABASE_URL="$STAGING_DATABASE_URL" npm run audit:dashboard-usage`.

## Observability Endpoint Check

For Sentry:

```bash
SDS_OBSERVABILITY_SINKS=sentry SDS_SENTRY_DSN="$SDS_SENTRY_DSN" npm test -- tests/observability-skeleton.test.ts
```

For OpenTelemetry:

```bash
SDS_OBSERVABILITY_SINKS=otel SDS_OTEL_ENDPOINT="$SDS_OTEL_ENDPOINT" npm test -- tests/observability-skeleton.test.ts
```

## Manual Acceptance Record

Record the release date, operator, database backup path, staging migration result, dashboard usage audit result, and observability endpoint result in the deployment ticket.
