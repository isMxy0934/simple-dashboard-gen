# Dashboard Render Package

`src/web/dashboard/render/` owns the viewer-facing render model and reusable card
frame shell.

Responsibilities:

- `render-model.ts` resolves dashboard cards, layout placement, request status,
  and view/card display metadata.
- `chart-frame.tsx` renders the shared card frame around already-materialized
  chart options.
- Presentation context is imported from `src/presentation/dashboard/`; do not
  create another presentation resolver here.

Boundaries:

- Do not inject binding data or materialize ECharts option templates in this package.
- ECharts option materialization belongs in
  `src/web/viewer/state/rendered-views.ts` and
  `src/renderers/echarts/browser/materialize-option.ts`.
- Renderer recipes and theme token refs belong under
  `src/renderers/echarts/recipes/` and `src/presentation/dashboard/`.
- Keep shell concerns here: card title/description, status, selection, drag,
  resize, overlays, and frame spacing. Renderer body visuals stay in renderer
  packages.
