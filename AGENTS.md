# Architecture Guide

This repository is organized by architectural layer:

- `app/`: Next.js entrypoints only
- `client/`: frontend product features
- `server/`: server-only logic and persistence/runtime services
- `components/`: reusable UI components shared across client features
- `agent/`: agent protocol, prompt, tool, runtime, and workflow logic
- `provider/`: model provider adapters and configuration
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

- `app -> client/components/server/agent/provider/domain/contracts/shared`
- `client -> components/domain/contracts/shared`
- `components -> domain/contracts/shared`
- `server -> agent/provider/domain/contracts/shared`
- `agent -> provider/domain/contracts/shared`
- `provider -> shared`
- `domain -> contracts/shared`
- `contracts -> shared`
- `shared -> (no higher-level product code)`

Forbidden dependencies:

- `domain -> client/app/server/components`
- `contracts -> client/app/server/domain/components/ai`
- `server -> client/components/app`
- `ai -> client/components/app`
- `components -> server/app/agent/provider`

When in doubt:

- If it defines data shape, put it in `contracts/`.
- If it defines business behavior, put it in `domain/`.
- If it talks to the browser, put it in `client/`.
- If it talks to the database or filesystem, put it in `server/`.
- If it is prompt/workflow/tool/runtime logic, put it in `agent/`.
- If it is model provider wiring, put it in `provider/`.

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

- `DashboardSpec`: dashboard metadata, layout, views, filters, and renderer template slots. It describes presentation structure and data entry points only.
- `QueryDefs`: read-only data acquisition contract. It describes SQL template, params, and output shape only.
- `Bindings`: view-slot-to-query wiring contract. It describes which query output fills which renderer slot, plus param resolution and optional result selection only.

### Frozen Invariants

- A persisted dashboard is exactly one `DashboardDocument`.
- `DashboardSpec` must not contain runtime data rows or execution-only state.
- `QueryDefs` must remain read-only query definitions. No mutation SQL, no UI state, no hidden business workflow state.
- `Bindings` must remain wiring only. Do not encode business logic, layout intent, or agent workflow state inside bindings.
- A `view` may declare multiple data slots.
- A slot may have at most one active binding in a valid document.
- A live binding must reference exactly one existing `query_id` and exactly one declared `slot_id`.
- A mock binding must carry its own mock rows and must not also act like a live binding.
- Each renderer slot must declare where runtime data is injected into the renderer template.
- `param_mapping` must fully explain how query params are resolved from filters, constants, or runtime context.
- `QueryDef.output` is the contract between SQL execution and binding. Runtime execution must be validated against it.
- Preview and publish must interpret the same contract semantics. Publish may be stricter, but it must not mean something different.
- If a view, slot, query, or binding is removed or replaced, the resulting `DashboardDocument` must stay internally consistent. No orphan bindings, orphan queries, or layout entries pointing to removed views.

### Design Rules

- Prefer extending `DashboardDocument` over adding parallel feature-specific config elsewhere.
- If a new capability changes dashboard behavior at runtime, first ask how it fits into `DashboardSpec`, `QueryDefs`, or `Bindings`.
- Treat ECharts as the renderer contract, not as a narrow line/bar/pie-only template subset.
- Keep `option_template` as a renderer template with explicit runtime-owned slots, not a dump of fully materialized runtime chart state.
- Keep runtime behavior explainable from contract contents plus explicit runtime input.
- Validation rules are part of the product design, not just defensive programming. If a rule matters for correctness, encode it in `contracts/validation.ts`.
- Prefer explicit slot-based data injection over implicit conventions like "all charts consume `dataset.source`".

### Non-Goals For Now

- Do not add a second semantic layer between `QueryDefs` and SQL unless it is clearly required.
- Do not move business meaning into frontend-only state or agent-only hidden state.
