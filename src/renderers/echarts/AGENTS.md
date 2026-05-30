# ECharts Renderer

`src/renderers/echarts/` owns ECharts option templates, recipe builders,
materialization, validation, and browser chart mounting.

Rules:

- Keep renderer validation independent from dashboard authoring workflows.
- Keep dashboard shell styling out of ECharts recipes; use chart presentation
  tokens for chart option styling.
- New ECharts recipes must register through `recipes/chart-recipe-registry.ts`.
- `getEChartsStageChartRecipeBuilder` is strict; recipe ids must be registered
  and removed aliases are not supported.
- Recipe ids are selected by template capability and view-intent compilation.
  Agents must not select recipe ids directly.
- Authoring/runtime compilation passes the resolved design kit, color theme, and
  view style presentation context into recipe builders; recipes emit `$theme` and
  `$i18n` refs in `option_template`, not resolved colors or locale strings.
- Locale chart labels resolve during materialization via
  `chartPresentation.chartLabels` supplied by viewer/authoring shells.
- Browser chart mounting receives a fully materialized option. Do not pass
  presentation context into `useEChartsChart`.
- `materializeEChartsOptionTemplate` resolves `$theme` / `$i18n` with
  `chartPresentation.colorThemeId`, `chartPresentation.designKitId`,
  `chartPresentation.viewStyleId`, and `chartLabels`.
