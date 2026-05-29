# Authoring Agent Layer

`src/ai/authoring/` owns the AI-facing authoring surface and the semantic-to-runtime
compilation path.

Rules:

- Agent-visible tools accept semantic intent only: `view_kind`, title/description,
  datasource/table, field roles, aggregation/filter/sort/limit intent, and optional
  mock values.
- Agents must not provide renderer ids, renderer contracts, slot paths, layout,
  bindings, SQL, or theme tokens through semantic view tools. Runtime code owns those.
- The dashboard template is the canonical policy boundary for supported semantic
  view kinds, renderer recipes, view families, layout defaults, and semantic skill
  availability.
- Use "template" for new authoring/runtime code and skill instructions. Use
  "design kit" only at the legacy presentation compatibility boundary.

When adding a new semantic `view_kind`, update these touchpoints together:

- `src/contracts/dashboard-view-intent.ts`
- `src/ai/authoring/semantic-view-kinds.ts`
- `src/ai/authoring/skills/<semantic-skill>/SKILL.md`
- `src/contracts/dashboard-template-capability-registry.ts`
- `src/ai/authoring/view-intent/internal-stage-chart-builders.ts`
- The relevant ECharts recipe registry entry if a new renderer recipe is needed
- `tests/dashboard-template.test.ts` coverage for skill availability, policy mapping,
  compiler output, and validation

Keep authoring preview and viewer behavior derived from `DashboardDocument`; do not
add parallel fixtures that bypass template policy.
