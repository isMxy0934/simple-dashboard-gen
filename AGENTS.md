# Architecture Guide

This repository is organized by architectural layer:

- `app/`: Next.js entrypoints only
- `client/`: frontend product features
- `server/`: server-only logic and persistence/runtime services
- `components/`: reusable UI components shared across client features
- `ai/`: agent, workflow, prompt, runtime, and model-facing logic
- `domain/`: pure business rules
- `contracts/`: shared contracts, schema, types, and validation
- `shared/`: generic helpers with no product ownership

Global rules:

- Keep `app/` thin. Route files should wire existing modules together, not implement business logic.
- Keep `client/` feature-scoped. Place feature UI inside `client/<feature>/ui`.
- Keep `server/` free of React and browser APIs.
- Keep `domain/` pure. No React, `fetch`, filesystem, database, or Next.js code.
- Keep `contracts/` declarative. No feature logic or runtime side effects.
- Keep `components/` reusable. Do not place feature-specific flows here.
- Keep `shared/` generic. If a helper clearly belongs to one layer, move it there.

Dependency direction:

- `app -> client/components/server/ai/domain/contracts/shared`
- `client -> components/domain/contracts/shared`
- `components -> domain/contracts/shared`
- `server -> ai/domain/contracts/shared`
- `ai -> domain/contracts/shared`
- `domain -> contracts/shared`
- `contracts -> shared`
- `shared -> (no higher-level product code)`

Forbidden dependencies:

- `domain -> client/app/server/components`
- `contracts -> client/app/server/domain/components/ai`
- `server -> client/components/app`
- `ai -> client/components/app`
- `components -> server/app/ai`

When in doubt:

- If it defines data shape, put it in `contracts/`.
- If it defines business behavior, put it in `domain/`.
- If it talks to the browser, put it in `client/`.
- If it talks to the database or filesystem, put it in `server/`.
- If it is prompt/workflow/tool/model logic, put it in `ai/`.

## Contract Kernel

The product kernel is:

- `DashboardDocument = DashboardSpec + QueryDefs + Bindings`

Treat `DashboardDocument` as the single source of truth for:

- authoring
- AI patch generation and review
- preview / runtime check
- save / publish persistence
- viewer runtime

Do not introduce a second dashboard representation that redefines the same meaning in UI state, server logic, or AI prompts. Ephemeral UI state is allowed, but dashboard behavior must always resolve back to `DashboardDocument`.

### Responsibilities

- `DashboardSpec`: dashboard metadata, layout, views, and filters. It describes presentation structure only.
- `QueryDefs`: read-only data acquisition contract. It describes SQL template, params, and result schema only.
- `Bindings`: view-to-query wiring contract. It describes param mapping and field mapping only.

### Frozen Invariants

- A persisted dashboard is exactly one `DashboardDocument`.
- `DashboardSpec` must not contain runtime data rows or execution-only state.
- `QueryDefs` must remain read-only query definitions. No mutation SQL, no UI state, no hidden business workflow state.
- `Bindings` must remain wiring only. Do not encode business logic, layout intent, or agent workflow state inside bindings.
- A `view` may have at most one active binding in a valid document.
- A live binding must reference exactly one existing `query_id`.
- A mock binding must carry its own mock rows and must not also act like a live binding.
- `field_mapping` must map query result fields into template fields required by the target view.
- `param_mapping` must fully explain how query params are resolved from filters, constants, or runtime context.
- `query.result_schema` is the contract between SQL execution and binding. Runtime execution must be validated against it.
- Preview and publish must interpret the same contract semantics. Publish may be stricter, but it must not mean something different.
- If a view, query, or binding is removed or replaced, the resulting `DashboardDocument` must stay internally consistent. No orphan bindings, orphan queries, or layout entries pointing to removed views.

### Design Rules

- Prefer extending `DashboardDocument` over adding parallel feature-specific config elsewhere.
- If a new capability changes dashboard behavior at runtime, first ask how it fits into `DashboardSpec`, `QueryDefs`, or `Bindings`.
- Keep `option_template` as a controlled template subset, not a dump of fully materialized runtime chart state.
- Keep runtime behavior explainable from contract contents plus explicit runtime input.
- Validation rules are part of the product design, not just defensive programming. If a rule matters for correctness, encode it in `contracts/validation.ts`.

### Non-Goals For Now

- Do not add a second semantic layer between `QueryDefs` and SQL unless it is clearly required.
- Do not support multi-query-per-view or multi-dataset chart composition until the core one-view / one-binding model is stable.
- Do not move business meaning into frontend-only state or agent-only hidden state.
