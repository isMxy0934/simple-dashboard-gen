# AI Dashboard Studio

AI-first dashboard builder built around one persisted contract:

- `DashboardDocument = DashboardSpec + QueryDefs + Bindings`

## Architecture

The repository is organized by layer:

- `src/app/`: Next.js entrypoints
- `src/web/`: authoring and viewer UI
- `src/server/`: API, runtime, persistence, datasource services
- `src/ai/authoring/`: pi-agent runtime integration, prompts, tool surface, capability scope, and authoring tools
- `src/renderers/`: renderer-specific materialization and validation
- `src/domain/`: pure dashboard business operations
- `src/contracts/`: shared contracts, types, and validation
- `src/web/i18n/`: frontend locale system
- `src/web/api/`: cross-feature browser API helpers
- `src/web/utils/`: cross-feature frontend helpers
- `src/web/styles/`: shared frontend styles
- `logs/`: runtime session logs

## Product Kernel

`DashboardDocument` is the single source of truth for:

- authoring
- AI edits
- preview and runtime checks
- save and publish
- viewer rendering

Core rules:

- `DashboardSpec` defines structure, layout, views, filters, and renderer slots
- `QueryDefs` define read-only data acquisition contracts
- `Bindings` define view-slot-to-query wiring contracts
- renderer runtime data must always enter through explicit slots

## Agent / Tool Model

The system is `pi-agent runtime + explicit tool surface` first.

- `pi-agent-core` owns the loop, event stream, provider boundary, and tool hooks
- the app layer owns context construction, capability scope, runtime tool surface, approval gating, and dashboard transactions
- `computeAuthoringScope` derives the allowed capability profile for the current turn
- `buildSurfaceFromScope` turns that decision into the active tools, tool choice, and prompt sections
- tools are the only formal mutation surface

The active tool surface is intentionally narrow:

- inspect/read tools: `getViews`, `getView`, `getDatasources`, `listDatasourceTables`, `getTableSchema`, `previewTableData`, `getQuery`, `getBinding`, `getDraftStatus`, `declareAuthoringGoal`
- author transaction tools: `runCheck`, `stageChart`, `stageDelete`, `composePatch`
- approval tool: `applyPatch`, exposed only for a matching local approval event

Datasource metadata is no longer injected into prompt context as full schema. The agent reads lightweight datasource and table metadata first, then calls `getTableSchema` and `previewTableData` only when needed.

Chart creation and deletion use transaction-level tools:

- `stageChart` stages query, view, binding, and layout changes atomically
- `stageDelete` stages deletion with dependent binding cleanup
- `composePatch` prepares an approval-ready patch from the working draft
- `applyPatch` applies only the approved pending proposal

## Reliability Checks

`runCheck` validates the current staged `DashboardDocument` itself.

It reports structured failures across:

- `contract`
- `runtime`
- `renderer`

Checks are derived from the staged document, not from hardcoded preview fixtures.

## Development

Required environment:

- `PI_PROVIDER`, for example `deepseek` or `openai`
- `PI_MODEL`, for example `deepseek-v4-pro` or `gpt-4.1-mini`
- Provider API key for the selected Pi model, for example `DEEPSEEK_API_KEY`
  or `OPENAI_API_KEY`
- Optional: `PI_THINKING_LEVEL` (`off`, `minimal`, `low`, `medium`, `high`,
  or `xhigh`)

Model metadata and request compatibility are resolved through Pi's
`ModelRegistry`. Runtime configuration is environment-only; the app does not
read Pi `.pi/settings.json`, `~/.pi/agent/settings.json`, or `auth.json`.

Useful commands:

```bash
npm run dev
npm run typecheck
npm run build
```

## System Test Datasource

The Docker Postgres init scripts create an isolated `system_test` schema with
deterministic ecommerce, marketing, and support tables for end-to-end agent
testing. New Docker volumes load it automatically from
`docker/init/03-system-test-datasource.sql`.

For an existing Docker volume, apply the script manually with `psql` or recreate
the local Postgres volume so Docker runs the init scripts again.

To register it as a datasource in the management UI:

- Engine: `Postgres`
- Connection URL: `postgres://dashboard:dashboard@localhost:5432/dashboard_studio`
- Allowed schemas: `system_test`

`Allowed schemas` is stored in the encrypted Postgres datasource secret as
`schemaAllowlist`; when set, schema introspection and generated agent context
only expose those schemas.

## Docs

- [Authoring Agent Runtime Baseline](./docs/hermes-authoring-agent-v2.1-final.md)
