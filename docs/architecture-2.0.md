# Architecture 2.0

## Summary

This codebase is organized around one kernel:

- `DashboardDocument = DashboardSpec + QueryDefs + Bindings`

Everything resolves back to that contract:

- authoring edits
- agent tool staging
- preview and runtime checks
- save and publish
- viewer rendering

## Layers

- `src/app/`
  Next.js entrypoints only
- `src/web/`
  authoring and viewer product UI
- `src/web/i18n/`
  frontend locale system and React i18n context
- `src/web/api/`
  cross-feature browser API/cache helpers
- `src/web/utils/`
  small cross-feature frontend helpers
- `src/web/styles/`
  shared frontend styles
- `src/server/`
  APIs, datasource services, runtime execution, persistence
- `src/agent/`
  prompt, workflow, tool surface, task/runtime orchestration
- `src/renderers/`
  renderer-specific materialization and validation
- `src/domain/`
  pure dashboard operators and deterministic business rules
- `src/contracts/`
  persisted shapes, invariants, and validation rules

## Contract Kernel

### DashboardSpec

Defines:

- dashboard metadata
- layout
- views
- filters
- renderer template slots

It does not contain:

- runtime rows
- execution-only state
- hidden agent state

### QueryDefs

Define:

- `datasource_id`
- `sql_template`
- `params`
- `output`

They are read-only data contracts. They do not encode business workflow state.

### Bindings

Define:

- `view_id`
- `slot_id`
- `query_id`
- `mode`
- `param_mapping`
- `field_mapping`
- `result_selector`

They are wiring contracts only.

## Renderer Model

The renderer shell is renderer-agnostic, but the current implementation is ECharts-first.

- `renderer.kind = "echarts"`
- `renderer.option_template` stores the persisted renderer template
- `renderer.slots` define explicit runtime injection points

The kernel does not model chart types like `bar`, `line`, or `metric`.
Those shapes are provided by agent skills or manual editing through explicit renderer contracts.

## Agent / Tool Model

The system is tool-first.

The agent never mutates hidden UI state directly. It operates through explicit tools:

- `getViews`
- `getView`
- `getQuery`
- `getBinding`
- `getDatasources`
- `getSchemaByDatasource`
- `runCheck`
- `upsertView`
- `upsertQuery`
- `upsertBinding`
- `composePatch`
- `applyPatch`

### Datasource Access

Prompt context includes only:

- dashboard summary
- view state summary
- datasource list summary

Full datasource schema is fetched only through `getSchemaByDatasource` when needed.

## Reliability Flow

The reliability pipeline is:

```text
stage contract
-> runCheck
-> repair if possible
-> composePatch
-> approval
-> applyPatch
```

`runCheck` validates the staged document itself and reports structured failures across:

- `contract`
- `runtime`
- `renderer`

Both server-side smoke validation and browser-side renderer validation are used for ECharts.

## Current Design Rules

- keep `src/app/` thin
- keep datasource schema out of default prompt context
- do not infer query semantics from renderer templates
- do not keep parallel dashboard representations
- do not hardcode preview fixtures for checks
- prefer explicit slot-based data injection
- stop auto-repair when repeated failures show no progress

## Current Non-Goals

- no second semantic layer between SQL and `QueryDefs`
- no renderer-specific business rules in `src/domain`
- no hidden datasource assumptions in prompt context
