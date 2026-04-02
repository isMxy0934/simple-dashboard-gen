# AI Dashboard Studio

AI-first dashboard builder built around one persisted contract:

- `DashboardDocument = DashboardSpec + QueryDefs + Bindings`

## Architecture

The repository is organized by layer:

- `src/app/`: Next.js entrypoints
- `src/web/`: authoring and viewer UI
- `src/server/`: API, runtime, persistence, datasource services
- `src/agent/`: prompt, workflow, tool, and runtime logic
- `src/renderers/`: renderer-specific materialization and validation
- `src/domain/`: pure dashboard business operations
- `src/contracts/`: shared contracts, types, and validation
- `src/shared/`: generic helpers
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

The system is `agent + explicit tools` first.

- the agent decides
- tools are the only formal mutation surface
- `upsertView` stages explicit renderer contracts
- `upsertQuery` stages explicit query contracts
- `upsertBinding` stages explicit binding contracts
- `composePatch` prepares an approval-ready patch
- `applyPatch` applies the approved staged patch

Datasource metadata is no longer injected into prompt context as full schema. The agent reads:

- lightweight datasource list via `getDatasources`
- full schema on demand via `getSchemaByDatasource`

## Reliability Checks

`runCheck` validates the current staged `DashboardDocument` itself.

It reports structured failures across:

- `contract`
- `runtime`
- `renderer`

Checks are derived from the staged document, not from hardcoded preview fixtures.

## Development

Required environment:

- `OPENAI_API_KEY`

Useful commands:

```bash
npm run dev
npm run typecheck
npm run build
```

## Docs

- [Architecture 2.0](./docs/architecture-2.0.md)
