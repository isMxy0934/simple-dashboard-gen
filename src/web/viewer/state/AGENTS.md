# Viewer State Package

`src/web/viewer/state/` owns viewer runtime derivation from dashboard data to
renderable view state.

Responsibilities:

- `viewer-state.ts` coordinates dashboard snapshot state, request state, filters,
  and refresh behavior.
- `rendered-views.ts` injects binding results, applies renderer transforms, and
  materializes ECharts options once before React chart mounting.

Boundaries:

- Do not duplicate layout/status/card model logic from
  `src/web/dashboard/render/render-model.ts`.
- Resolve chart presentation per view so `DashboardView.view_style_id` overrides
  can differ from the dashboard default.
- Pass `chartPresentation` (`designKitId`, `colorThemeId`, `viewStyleId`,
  `chartLabels`) into every `materializeEChartsOptionTemplate` call so `$theme`,
  `$i18n`, and view-style presets resolve consistently before chart mount.
- `useEChartsChart` must receive a fully materialized option and only handle
  ECharts mount/update/resize.
- Viewer state reads committed dashboard data and execution results. It must not
  apply authoring proposals or working draft mutations directly.
