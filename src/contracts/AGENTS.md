# Contracts Layer

`src/contracts/` contains shared data shapes and validation contracts used by
authoring, server execution, renderer materialization, and the viewer.

Allowed here:

- Type definitions and schema constants.
- Normalization and validation for contract-shaped values.
- Request and response contracts crossing process or layer boundaries.
- Template capability declarations that map semantic view kinds to runtime policy.

Rules:

- Keep files declarative and deterministic.
- Do not place feature orchestration, persistence, React, provider, or route logic here.
- Do not import from `src/web/`, `src/server/`, `src/ai/`, or `src/domain/`.
- `DashboardDocument` remains the single cross-layer truth for dashboard spec,
  queries, bindings, and view intent.
- `DashboardViewIntent` is semantic. It must not grow renderer option templates,
  slot paths, SQL strings, or UI layout internals.

Dashboard template contract rules:

- `dashboard-templates.ts` owns canonical template ids, versions, bootstrap
  defaults, and registered template definitions.
- `dashboard-template-capability-registry.ts` owns the template -> semantic view
  kind -> renderer recipe/view family policy.
- `dashboard-view-policy.ts` may expose compatibility helpers, but new code should
  prefer template-named APIs.
- Keep presentation/design-kit aliases isolated to explicit normalization helpers.
  Do not introduce new design-kit policy names for template-owned behavior.

Use `src/contracts/` for shared shape and policy declarations. Use
`src/domain/` for business behavior over those contracts.
