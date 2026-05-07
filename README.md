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

- `OPENAI_API_KEY`

Useful commands:

```bash
npm run dev
npm run typecheck
npm run build
```

## Docs

- [Authoring Agent Runtime Baseline](./docs/hermes-authoring-agent-v2.1-final.md)
