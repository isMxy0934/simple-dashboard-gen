# ECharts Renderer

This package owns ECharts option templates, materialization, validation, and recipe presets.

Rules:

- Keep renderer validation independent from dashboard authoring workflows.
- Keep dashboard shell styling out of ECharts recipes; use `DashboardTheme.chart` tokens for chart option styling.
- New stageChart recipes must register through `recipes/chart-recipe-registry.ts`.
- Browser chart mounting receives a fully materialized option. Do not pass presentation context into `useEChartsChart`.
- Legacy compatibility fixes should be non-destructive at runtime unless an explicit migration flow writes the dashboard document.
