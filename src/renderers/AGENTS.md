# Renderers

`src/renderers/` owns renderer contracts, validation, slot formatting, and renderer-specific preview/materialization logic.

Boundaries:

- Renderer packages may consume the presentation DSL from `src/presentation/dashboard/`.
- Renderer packages must not import React viewer components, authoring UI, database code, or server repositories.
- Renderer recipes should express colors, labels, and report styling through `$theme` and `$i18n` refs instead of hardcoded presentation values.
- Materialization should resolve bindings, transforms, `$theme`, and `$i18n` exactly once before chart mount.

For dashboard ECharts:

- Recipe builders live under `src/renderers/echarts/recipes/`.
- `chart-recipe-registry.ts` is the single ECharts recipe lookup used by authoring skills.
- `presentation-compatibility.ts` reports legacy option templates that will not fully respond to theme changes.
