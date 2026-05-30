# Authoring Agent Layer

`src/ai/authoring/` owns the AI Decision Core: conversation context becomes a
scoped tool surface, semantic view intent, checked `WorkingDraft`, approval
proposal, and finally a persisted `DashboardDocument`.

Responsibilities:

- Compute authoring scope and build the runtime tool surface.
- Keep prompts and tool contracts aligned with the semantic authoring boundary.
- Compile `DashboardViewIntent` through template capability policy into runtime
  query, view, binding, renderer, and layout changes.
- Maintain `WorkingDraft`, `runCheck`, `composePatch`, and approval gating.

Rules:

- Model-facing create/update work goes through `stageViewIntent`.
- `stageViewIntent` accepts semantic intent only: `view_kind`, title/description,
  datasource/table, field roles, aggregation/filter/sort/limit intent, and
  optional mock values.
- Agents must not provide renderer ids, renderer contracts, slot paths, layout,
  bindings, SQL, or theme tokens through semantic view tools. Runtime code owns
  those choices.
- `stageQuery` is only a guarded correction lane for an existing query and must
  preserve the query output schema expected by current bindings.
- `stageDelete` is for pure removals. Delete-and-rebuild or replace requests
  should be expressed as a revised semantic view intent.
- Internal chart transaction helpers are implementation details used by the
  compiler path; do not expose recipe-level creation tools to the model-facing
  runtime surface.
- The dashboard template is the canonical policy boundary for supported semantic
  view kinds, renderer recipes, view families, layout defaults, and semantic skill
  availability.
- Use "template" for new authoring/runtime code and skill instructions. Keep
  presentation compatibility aliases isolated to explicit normalization code.

When adding a new semantic `view_kind`, update these touchpoints together:

- `src/contracts/dashboard-view-intent.ts`
- `src/ai/authoring/semantic-view-kinds.ts`
- `src/ai/authoring/skills/<semantic-skill>/SKILL.md`
- `src/contracts/dashboard-template-capability-registry.ts`
- `src/ai/authoring/view-intent/compiler.ts`
- `src/ai/authoring/view-intent/internal-stage-chart-builders.ts`
- The relevant ECharts recipe registry entry if a new renderer recipe is needed.
- Focused tests in `tests/dashboard-template.test.ts` and
  `tests/authoring-reliability.test.ts` for skill availability, policy mapping,
  compiler output, tool surface visibility, and validation.

Keep authoring preview and viewer behavior derived from `DashboardDocument`; do
not add parallel fixtures that bypass template policy.
