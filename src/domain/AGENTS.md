# Domain Layer

`src/domain/` contains pure business rules over shared contracts.

Rules:

- No React.
- No `fetch`.
- No database code.
- No filesystem access.
- No Next.js types or route logic.
- No AI provider/runtime code.

Put code here when it answers:

- How the dashboard document behaves.
- How layout is derived from document state.
- How bindings are formed or reconciled.
- How contract semantics are normalized or interpreted.

Subareas:

- `src/domain/dashboard`: dashboard-specific rules.
- `src/domain/shared`: domain-scoped helpers.

Do not put renderer-specific option parsing, slot-path writing, or ECharts
validation in `src/domain/`. Those belong in `src/renderers/`.

Do not put shared shell/chart theme registries, `$theme`/`$i18n` presentation
tokens, or viewer presentation context resolution in `src/domain/`. Those belong
in `src/presentation/`.

Do not put authoring tool orchestration or approval workflow logic here. Those
belong in `src/ai/authoring/` and `src/server/authoring/`.
