# Viewer State Package

`src/web/viewer/state/` owns viewer runtime derivation from dashboard data to renderable view state.

Responsibilities:

- `viewer-state.ts` coordinates dashboard snapshot state, request state, filters, and refresh behavior.
- `rendered-views.ts` injects binding results, applies renderer transforms, and materializes ECharts options once before React chart mounting.

Boundaries:

- Do not duplicate layout/status/card model logic from `src/web/dashboard/render/render-model.ts`.
- Do not call presentation resolvers independently per view; receive one resolved chart presentation context from the viewer shell.
- `useEChartsChart` must receive a fully materialized option and only handle ECharts mount/update/resize.
