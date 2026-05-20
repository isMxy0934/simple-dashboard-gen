# ECharts Renderer

This package owns ECharts option templates, materialization, validation, and recipe presets.

Rules:

- Keep renderer validation independent from dashboard authoring workflows.
- Keep dashboard shell styling out of ECharts recipes; use design kit chart tokens for chart option styling.
- New stageChart recipes must register through `recipes/chart-recipe-registry.ts`.
- `getEChartsStageChartRecipeBuilder` is strict; recipe ids must be registered and removed aliases are not supported.
- `stageChart` passes the resolved design kit/color theme/view style presentation context into recipe builders; recipes emit `$theme` / `$i18n` refs in `option_template`, not resolved colors or locale strings.
- Locale chart labels resolve during materialization via `chartPresentation.chartLabels` supplied by viewer/authoring shells.
- Browser chart mounting receives a fully materialized option. Do not pass presentation context into `useEChartsChart`.
- `materializeEChartsOptionTemplate` resolves `$theme` / `$i18n` with `chartPresentation.colorThemeId`, `chartPresentation.designKitId`, `chartPresentation.viewStyleId`, and `chartLabels`.
