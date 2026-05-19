# ECharts Renderer

This package owns ECharts option templates, materialization, validation, and recipe presets.

Rules:

- Keep renderer validation independent from dashboard authoring workflows.
- Keep dashboard shell styling out of ECharts recipes; use `DashboardTheme.chart` tokens for chart option styling.
- New stageChart recipes must register through `recipes/chart-recipe-registry.ts`.
- `getEChartsStageChartRecipeBuilder` resolves legacy aliases the same way as the AI skill registry (for example `echarts-data-table` → `echarts-ranked-bar`).
- `stageChart` passes only `themeId` into recipe builders; recipes emit `$theme` / `$i18n` refs in `option_template`, not resolved colors or locale strings.
- Locale chart labels resolve during materialization via `chartPresentation.chartLabels` supplied by viewer/authoring shells.
- Browser chart mounting receives a fully materialized option. Do not pass presentation context into `useEChartsChart`.
- `materializeEChartsOptionTemplate` applies non-destructive renderer compatibility migrations, then resolves `$theme` / `$i18n` with `chartPresentation.themeId` and `chartLabels`.
- Server presentation validation audits the compatibility-migrated renderer, not the raw stored template.
- Legacy compatibility fixes should be non-destructive at runtime unless an explicit migration flow writes the dashboard document.
