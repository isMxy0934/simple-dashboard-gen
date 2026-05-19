# Presentation Layer

`src/presentation/` contains display-oriented rules shared by web surfaces,
renderers, and authoring.

Allowed here:

- Presentation theme registries and tokens
- Display label fallback maps
- Viewer/render presentation context resolution
- Small presentation DSL helpers consumed by renderers
- Shared `DashboardTheme` tokens that produce both shell CSS variables and chart `$theme` refs

Rules:

- No React components.
- No database code.
- No filesystem access.
- No renderer validation or slot-path mutation.
- Do not add ad hoc chart colors in recipes when a `DashboardTheme.chart` token can represent the intent.

Use `src/presentation/` when a concern is not core dashboard behavior, but must be
shared consistently across shell UI, authoring, and chart renderers.
