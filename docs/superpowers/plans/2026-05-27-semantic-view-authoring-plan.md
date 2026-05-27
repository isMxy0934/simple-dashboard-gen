# Semantic View Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace recipe-facing chart authoring with semantic view authoring so the agent submits business intent and the active Design Kit deterministically compiles the renderer.

**Architecture:** The public authoring boundary becomes `loadSkill(semantic-skill)` plus `stageViewIntent(view_kind, fields, title, description)`. `DashboardDocument` stores `view_intent` as the semantic source of truth, while ECharts renderers remain internal compiler output. `DesignKitPolicy` owns `view_kind + design_kit + view_style -> recipe + preset + layout + validation contract`.

**Tech Stack:** Next.js 15, TypeScript strict, Node built-in tests with `--experimental-strip-types`, pi-agent tool runtime, ECharts renderer recipes, repository-local presentation contracts.

---

## File Structure

- Create: `src/contracts/dashboard-view-intent.ts`
  - Public semantic view intent types, view kind ids, and helpers.
- Modify: `src/contracts/dashboard.ts`
  - Add required `view_intent` to `DashboardView`.
- Modify: `src/contracts/index.ts`
  - Export semantic view intent contract.
- Create: `src/contracts/dashboard-view-policy.ts`
  - Design Kit policy for supported view kinds and recipe mapping.
- Modify: `src/contracts/validation.ts`
  - Require `view_intent`, validate view kind support, forbid shell chrome in body, and verify renderer recipe matches compiler policy.
- Create: `src/ai/authoring/view-intent/compiler.ts`
  - Compile semantic view intent into the internal recipe id, renderer, bindings, and layout.
- Create: `src/ai/authoring/tools/stage-view-intent-tool.ts`
  - New agent-facing write tool.
- Modify: `src/ai/authoring/tools/schemas.ts`
  - Add `stageViewIntentInputSchema`; keep stageChart schema only while internal tests still need it.
- Modify: `src/ai/authoring/contracts/tool-io.ts`
  - Add `StageViewIntentToolInput` / output and replace public `stageChart` tool entry with `stageViewIntent`.
- Modify: `src/ai/authoring/tools/registry.ts`
  - Remove `stageChart` / `stageReplaceChart` from authoring tool registry and add `stageViewIntent`.
- Modify: `src/ai/authoring/tools/registry-builder.ts`
  - Register `buildStageViewIntentTool`; update declaration schema from `chartSkillId` to `viewKind`.
- Modify: `src/ai/authoring/messages/system-prompt.ts`
  - Explain semantic view selection and Design Kit compilation; remove recipe-facing guidance.
- Modify: `src/server/ai/skill-loader.ts`
  - Load only semantic authoring skills and reject `echarts-*`.
- Create: `src/ai/authoring/skills/stat-kpi/SKILL.md`
- Create: `src/ai/authoring/skills/time-trend/SKILL.md`
- Create: `src/ai/authoring/skills/category-comparison/SKILL.md`
- Create: `src/ai/authoring/skills/ranked-bar/SKILL.md`
- Create: `src/ai/authoring/skills/signal-list/SKILL.md`
- Create: `src/ai/authoring/skills/funnel/SKILL.md`
- Create: `src/ai/authoring/skills/bounded-gauge/SKILL.md`
  - Semantic skill manuals. No `echarts-*`, recipe id, slot path, layout, or renderer option language.
- Delete: `src/ai/authoring/skills/echarts-bar/SKILL.md`
- Delete: `src/ai/authoring/skills/echarts-line/SKILL.md`
- Delete: `src/ai/authoring/skills/echarts-kpi-card/SKILL.md`
- Delete: `src/ai/authoring/skills/echarts-kpi-text/SKILL.md`
- Delete: `src/ai/authoring/skills/echarts-kpi-gauge/SKILL.md`
- Delete: `src/ai/authoring/skills/echarts-signal-list/SKILL.md`
- Delete: `src/ai/authoring/skills/echarts-funnel/SKILL.md`
- Delete: `src/ai/authoring/skills/echarts-ranked-bar/SKILL.md`
  - Remove renderer recipe manuals from the agent-visible skill catalog.
- Modify: `src/web/i18n/messages/en.ts`
- Modify: `src/web/i18n/messages/zh.ts`
  - Rename user-facing tool label from chart transaction to view intent transaction.
- Modify tests:
  - `tests/dashboard-template.test.ts`
  - `tests/authoring-reliability.test.ts`
  - `tests/render-input-and-approval.test.ts`
  - `tests/authoring-intent.test.ts`
  - `tests/scope-manager.test.ts`

---

### Task 1: Add Semantic View Intent Contract

**Files:**
- Create: `src/contracts/dashboard-view-intent.ts`
- Modify: `src/contracts/dashboard.ts`
- Modify: `src/contracts/index.ts`
- Test: `tests/dashboard-template.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add these imports near the top of `tests/dashboard-template.test.ts`:

```ts
const {
  DASHBOARD_VIEW_KIND_IDS,
} = await import("../src/contracts/dashboard-view-intent.ts");
```

Add these tests near the existing presentation validation tests:

```ts
test("semantic view kind registry exposes the supported authoring view kinds", () => {
  assert.deepEqual([...DASHBOARD_VIEW_KIND_IDS], [
    "stat_kpi",
    "time_trend",
    "category_comparison",
    "ranked_bar",
    "signal_list",
    "funnel",
    "bounded_gauge",
  ]);
});

test("dashboard validation requires view_intent on every view", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.views = [
    {
      id: "v_without_intent",
      title: "Total sales",
      renderer: makeSimpleRenderer(),
    },
  ];

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /view_intent is required/,
  );
});

test("dashboard validation rejects unknown semantic view kinds", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.views = [
    {
      ...makeSimpleView("v_bad_kind"),
      view_intent: {
        view_kind: "freeform_chart",
        data_mode: "live",
        datasource_id: "testing-db",
        table: "sales_weekly_fact",
        fields: {},
      },
    } as never,
  ];

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /view_intent.view_kind must be a registered semantic view kind/,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-template.test.ts
```

Expected: FAIL because `dashboard-view-intent.ts` does not exist and validation does not require `view_intent`.

- [ ] **Step 3: Add the semantic view intent contract**

Create `src/contracts/dashboard-view-intent.ts`:

```ts
import type { Binding, QueryParamType } from "./dashboard";

export const DASHBOARD_VIEW_KIND_IDS = [
  "stat_kpi",
  "time_trend",
  "category_comparison",
  "ranked_bar",
  "signal_list",
  "funnel",
  "bounded_gauge",
] as const;

export type DashboardViewKind = (typeof DASHBOARD_VIEW_KIND_IDS)[number];

export type DashboardViewIntentDataMode = "live" | "mock";

export type DashboardViewIntentFieldRole =
  | "value"
  | "time"
  | "category"
  | "metric"
  | "series";

export interface DashboardViewIntentField {
  source_field: string;
  label?: string;
  type?: QueryParamType;
  aggregation?: string;
  time_grain?: "day" | "week" | "month";
}

export interface DashboardViewIntentFilter {
  field: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  value: string | number | boolean;
}

export interface DashboardViewIntent {
  view_kind: DashboardViewKind;
  datasource_id: string;
  table: string;
  data_mode: DashboardViewIntentDataMode;
  fields: Partial<Record<DashboardViewIntentFieldRole, DashboardViewIntentField>>;
  sort?: {
    field_role?: DashboardViewIntentFieldRole;
    direction?: "asc" | "desc";
  };
  limit?: number;
  filters?: DashboardViewIntentFilter[];
  mock_data?: Binding["mock_data"];
  mock_value?: Binding["mock_value"];
}

export function isDashboardViewKind(value: string): value is DashboardViewKind {
  return (DASHBOARD_VIEW_KIND_IDS as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Require `view_intent` on `DashboardView`**

Modify `src/contracts/dashboard.ts`:

```ts
import type { DashboardViewIntent } from "./dashboard-view-intent";
```

Add the property to `DashboardView`:

```ts
export interface DashboardView {
  id: string;
  title: string;
  description?: string;
  view_style_id?: string;
  view_intent: DashboardViewIntent;
  renderer: DashboardRenderer;
}
```

- [ ] **Step 5: Export the new contract**

Modify `src/contracts/index.ts`:

```ts
export * from "./dashboard-view-intent";
```

- [ ] **Step 6: Add validation for required intent and known view kind**

Modify `src/contracts/validation.ts`:

```ts
import {
  DASHBOARD_VIEW_KIND_IDS,
  isDashboardViewKind,
} from "./dashboard-view-intent";
```

Add a set with the other validation constants:

```ts
const DASHBOARD_VIEW_KIND_ID_SET = new Set<string>(DASHBOARD_VIEW_KIND_IDS);
```

Inside the `views.forEach` block, after title validation, add:

```ts
if (!isRecord(view.view_intent)) {
  pushIssue(issues, `${path}.view_intent`, "view_intent is required");
} else {
  const viewKind =
    typeof view.view_intent.view_kind === "string"
      ? view.view_intent.view_kind.trim()
      : "";
  if (!viewKind) {
    pushIssue(
      issues,
      `${path}.view_intent.view_kind`,
      "view_intent.view_kind must be a non-empty string",
    );
  } else if (!DASHBOARD_VIEW_KIND_ID_SET.has(viewKind)) {
    pushIssue(
      issues,
      `${path}.view_intent.view_kind`,
      "view_intent.view_kind must be a registered semantic view kind",
    );
  }
}
```

- [ ] **Step 7: Update local test fixtures to include valid `view_intent`**

Where tests create views with `makeSimpleView(...)`, update the fixture helper in `tests/dashboard-template.test.ts` to include:

```ts
view_intent: {
  view_kind: "stat_kpi",
  datasource_id: "testing-db",
  table: "sales_weekly_fact",
  data_mode: "mock",
  fields: {
    value: {
      source_field: "gmv",
      aggregation: "sum",
    },
  },
},
```

- [ ] **Step 8: Run contract tests**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-template.test.ts
```

Expected: PASS for the new semantic view kind tests; remaining failures point to other fixtures that still need `view_intent`.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/contracts/dashboard-view-intent.ts src/contracts/dashboard.ts src/contracts/index.ts src/contracts/validation.ts tests/dashboard-template.test.ts
git commit -m "feat: add semantic view intent contract"
```

Expected: commit succeeds.

---

### Task 2: Add Design Kit View Policy and Compiler Mapping

**Files:**
- Create: `src/contracts/dashboard-view-policy.ts`
- Create: `src/ai/authoring/view-intent/compiler.ts`
- Test: `tests/dashboard-template.test.ts`

- [ ] **Step 1: Write failing policy and compiler tests**

In `tests/dashboard-template.test.ts`, import:

```ts
const {
  getDesignKitSupportedViewKinds,
  getDesignKitViewKindMapping,
} = await import("../src/contracts/dashboard-view-policy.ts");
const {
  compileDashboardViewIntent,
} = await import("../src/ai/authoring/view-intent/compiler.ts");
```

Add:

```ts
test("executive report policy maps stat KPI to the internal KPI card recipe", () => {
  assert.equal(
    getDesignKitSupportedViewKinds("executive_report").includes("stat_kpi"),
    true,
  );
  assert.deepEqual(getDesignKitViewKindMapping({
    designKitId: "executive_report",
    viewKind: "stat_kpi",
    viewStyleId: "emphasis",
  }), {
    recipeId: "echarts-kpi-card",
    bodyContract: "shell_chrome_forbidden",
  });
});

test("compiler emits executive stat KPI renderer from semantic intent", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.presentation = {
    design_kit_id: "executive_report",
    color_theme_id: "purple",
    default_view_style_id: "emphasis",
  };

  const output = compileDashboardViewIntent({
    dashboard: document,
    title: "Total sales",
    intent: {
      view_kind: "stat_kpi",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      data_mode: "mock",
      fields: {
        value: { source_field: "gmv", aggregation: "sum" },
      },
    },
  });

  assert.equal(output.recipeId, "echarts-kpi-card");
  assert.equal(output.renderer.recipe_id, "echarts-kpi-card");
  assert.equal(output.renderer.slots[0]?.id, "value");
  assert.equal(output.layout.desktop.w, 3);
  assert.equal(output.layout.desktop.h, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-template.test.ts
```

Expected: FAIL because the new policy and compiler modules do not exist.

- [ ] **Step 3: Create design kit view policy**

Create `src/contracts/dashboard-view-policy.ts`:

```ts
import type { EChartsStageChartRecipeId } from "./dashboard-chart-recipes";
import {
  EXECUTIVE_REPORT_DESIGN_KIT_ID,
  OPERATIONAL_REPORT_DESIGN_KIT_ID,
} from "./dashboard-presentation";
import type { DashboardViewKind } from "./dashboard-view-intent";

export interface DesignKitViewKindMapping {
  recipeId: EChartsStageChartRecipeId;
  bodyContract: "shell_chrome_forbidden";
}

const ALL_VIEW_KINDS: readonly DashboardViewKind[] = [
  "stat_kpi",
  "time_trend",
  "category_comparison",
  "ranked_bar",
  "signal_list",
  "funnel",
  "bounded_gauge",
];

const VIEW_KIND_TO_RECIPE: Record<DashboardViewKind, EChartsStageChartRecipeId> = {
  stat_kpi: "echarts-kpi-card",
  time_trend: "echarts-line",
  category_comparison: "echarts-bar",
  ranked_bar: "echarts-ranked-bar",
  signal_list: "echarts-signal-list",
  funnel: "echarts-funnel",
  bounded_gauge: "echarts-kpi-gauge",
};

export function getDesignKitSupportedViewKinds(
  designKitId: string,
): readonly DashboardViewKind[] {
  if (
    designKitId === OPERATIONAL_REPORT_DESIGN_KIT_ID ||
    designKitId === EXECUTIVE_REPORT_DESIGN_KIT_ID
  ) {
    return ALL_VIEW_KINDS;
  }
  return [];
}

export function getDesignKitViewKindMapping(input: {
  designKitId: string;
  viewKind: DashboardViewKind;
  viewStyleId: string;
}): DesignKitViewKindMapping | null {
  if (!getDesignKitSupportedViewKinds(input.designKitId).includes(input.viewKind)) {
    return null;
  }
  return {
    recipeId: VIEW_KIND_TO_RECIPE[input.viewKind],
    bodyContract: "shell_chrome_forbidden",
  };
}
```

- [ ] **Step 4: Create the semantic view compiler**

Create `src/ai/authoring/view-intent/compiler.ts`:

```ts
import type {
  DashboardDocument,
  DashboardRenderer,
  DashboardLayoutItem,
} from "@/contracts";
import type { EChartsStageChartRecipeId } from "@/contracts/dashboard-chart-recipes";
import type { DashboardViewIntent } from "@/contracts/dashboard-view-intent";
import { getDesignKitViewKindMapping } from "@/contracts/dashboard-view-policy";
import { getStageChartBuilder } from "@/ai/authoring/skills/registry";
import type {
  StageChartFieldMappings,
  StageChartLayoutTemplate,
} from "@/ai/authoring/skills/contract";
import { resolveViewPresentationContext } from "@/presentation/dashboard/presentation-context";

export interface CompileDashboardViewIntentInput {
  dashboard: DashboardDocument;
  viewId?: string;
  title: string;
  description?: string;
  intent: DashboardViewIntent;
}

export interface CompileDashboardViewIntentOutput {
  recipeId: EChartsStageChartRecipeId;
  renderer: DashboardRenderer;
  bindings: Array<{
    slot_id: string;
    field_role: keyof StageChartFieldMappings;
    value_kind: "rows" | "array" | "object" | "scalar";
    required?: boolean;
    formatter?: "integer" | "usd_0" | "usd_2";
  }>;
  layout: StageChartLayoutTemplate;
}

function toStageChartFields(intent: DashboardViewIntent): StageChartFieldMappings {
  return Object.fromEntries(
    Object.entries(intent.fields).map(([role, field]) => [
      role,
      {
        source_field: field.source_field,
        result_field:
          role === "time"
            ? "time_value"
            : role === "category"
              ? "category_value"
              : role === "series"
                ? "series_value"
                : role === "metric"
                  ? "metric_value"
                  : "value",
        label: field.label,
        type: field.type,
        aggregation: field.aggregation,
      },
    ]),
  ) as StageChartFieldMappings;
}

export function compileDashboardViewIntent(
  input: CompileDashboardViewIntentInput,
): CompileDashboardViewIntentOutput {
  const presentation = resolveViewPresentationContext(input.dashboard, {
    viewId: input.viewId,
  });
  const mapping = getDesignKitViewKindMapping({
    designKitId: presentation.designKit.id,
    viewKind: input.intent.view_kind,
    viewStyleId: presentation.viewStyle.id,
  });
  if (!mapping) {
    throw new Error(
      `unsupported_view_kind: ${input.intent.view_kind} is not supported for ${presentation.designKit.id}.`,
    );
  }
  const builder = getStageChartBuilder(mapping.recipeId);
  if (!builder) {
    throw new Error(`missing_internal_recipe_builder: ${mapping.recipeId}`);
  }
  const built = builder.build({
    title: input.title,
    description: input.description,
    queryOutput: null,
    fields: toStageChartFields(input.intent),
    presentation,
  });
  return {
    recipeId: mapping.recipeId,
    renderer: built.renderer,
    bindings: built.bindings,
    layout: built.layout,
  };
}
```

- [ ] **Step 5: Run policy/compiler tests**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-template.test.ts
```

Expected: PASS for policy and compiler tests after fixture updates.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/contracts/dashboard-view-policy.ts src/ai/authoring/view-intent/compiler.ts tests/dashboard-template.test.ts
git commit -m "feat: add semantic view compiler policy"
```

Expected: commit succeeds.

---

### Task 3: Implement `stageViewIntent` Vertical Slice for `stat_kpi`

**Files:**
- Create: `src/ai/authoring/tools/stage-view-intent-tool.ts`
- Modify: `src/ai/authoring/tools/schemas.ts`
- Modify: `src/ai/authoring/contracts/tool-io.ts`
- Modify: `src/ai/authoring/tools/registry-builder.ts`
- Test: `tests/authoring-reliability.test.ts`

- [ ] **Step 1: Write failing stageViewIntent tests**

In `tests/authoring-reliability.test.ts`, import `buildStageViewIntentTool` and `stageViewIntentInputSchema` next to the existing stage chart imports.

Add:

```ts
test("stageViewIntent creates stat KPI transaction without exposing recipe ids", async () => {
  const harness = makeHarness();
  const result = await executeTool<{
    artifact_ids: { view_id: string; query_id?: string; binding_ids: string[] };
    draft_status: { missing_required_bindings: unknown[]; blockers: string[] };
  }>(harness.stageViewIntent, {
    view_kind: "stat_kpi",
    title: "销售总额",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  });
  const candidate = harness.candidate();
  const view = candidate.dashboard_spec.views[0];

  assert.equal(view?.view_intent.view_kind, "stat_kpi");
  assert.equal(view?.renderer.recipe_id, "echarts-kpi-card");
  assert.equal(candidate.query_defs.length, 1);
  assert.equal(candidate.bindings.length, 1);
  assert.equal(result.artifact_ids.binding_ids.length, 1);
  assert.equal(result.draft_status.blockers.includes("missing_required_bindings"), false);
});

test("stageViewIntent schema rejects renderer implementation fields", () => {
  assert.throws(
    () =>
      Value.Parse(stageViewIntentInputSchema, {
        view_kind: "stat_kpi",
        skill_id: "echarts-kpi-card",
        recipe_id: "echarts-kpi-card",
        renderer: { kind: "echarts" },
        layout: { desktop: { w: 3, h: 2 } },
        title: "销售总额",
        datasource_id: "testing-db",
        table: "sales_weekly_fact",
        fields: { value: { source_field: "gmv", aggregation: "sum" } },
      }),
    /Unexpected property/,
  );
});
```

Update `makeHarness()` to expose `stageViewIntent` built from the same runtime dependencies as `stageChart`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/authoring-reliability.test.ts
```

Expected: FAIL because `stageViewIntent` does not exist.

- [ ] **Step 3: Add tool input/output types**

Modify `src/ai/authoring/contracts/tool-io.ts`:

```ts
import type {
  DashboardViewIntent,
  DashboardViewIntentFieldRole,
} from "@/contracts/dashboard-view-intent";
```

Add:

```ts
export interface StageViewIntentToolInput {
  goal_id?: string;
  reason?: string;
  view_kind: DashboardViewIntent["view_kind"];
  title: string;
  description?: string;
  target_view_id?: string;
  datasource_id: string;
  table: string;
  data_mode?: "live" | "mock";
  fields: DashboardViewIntent["fields"];
  sort?: DashboardViewIntent["sort"];
  limit?: number;
  filters?: DashboardViewIntent["filters"];
  mock_data?: DashboardViewIntent["mock_data"];
  mock_value?: DashboardViewIntent["mock_value"];
}

export interface StageViewIntentToolOutput extends StageChartToolOutput {
  view_kind: DashboardViewIntent["view_kind"];
}
```

In `AuthoringTools`, replace the public stage chart entries:

```ts
stageViewIntent: {
  input: StageViewIntentToolInput;
  output: StageViewIntentToolOutput;
};
```

- [ ] **Step 4: Add tool schema**

Modify `src/ai/authoring/tools/schemas.ts`:

```ts
const dashboardViewKindSchema = Type.Union([
  Type.Literal("stat_kpi"),
  Type.Literal("time_trend"),
  Type.Literal("category_comparison"),
  Type.Literal("ranked_bar"),
  Type.Literal("signal_list"),
  Type.Literal("funnel"),
  Type.Literal("bounded_gauge"),
]);

export const stageViewIntentInputSchema = Type.Object(
  {
    goal_id: Type.Optional(Type.String({ minLength: 1 })),
    reason: Type.Optional(Type.String()),
    view_kind: dashboardViewKindSchema,
    title: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    target_view_id: Type.Optional(Type.String({ minLength: 1 })),
    datasource_id: Type.String({ minLength: 1 }),
    table: Type.String({ minLength: 1 }),
    data_mode: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("mock")])),
    fields: Type.Object(
      {
        time: Type.Optional(stageChartFieldSchema),
        category: Type.Optional(stageChartFieldSchema),
        metric: Type.Optional(stageChartFieldSchema),
        value: Type.Optional(stageChartFieldSchema),
        series: Type.Optional(stageChartFieldSchema),
      },
      { additionalProperties: false },
    ),
    sort: stageChartIntentSchemaProperties.sort,
    limit: stageChartIntentSchemaProperties.limit,
    filters: stageChartIntentSchemaProperties.filters,
    mock_data: stageChartIntentSchemaProperties.mock_data,
    mock_value: stageChartIntentSchemaProperties.mock_value,
  },
  { additionalProperties: false },
);
```

- [ ] **Step 5: Implement `buildStageViewIntentTool`**

Create `src/ai/authoring/tools/stage-view-intent-tool.ts` by adapting `stage-chart-tool.ts`:

```ts
import type { DashboardViewIntent } from "@/contracts/dashboard-view-intent";
import type {
  DraftStatusToolOutput,
  StageViewIntentToolInput,
  StageViewIntentToolOutput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import { defineTool } from "@/ai/authoring/tools/definition";
import { stageViewIntentInputSchema } from "@/ai/authoring/tools/schemas";
import { stageChartTransaction } from "@/ai/authoring/tools/stage-chart-tool";
import { compileDashboardViewIntent } from "@/ai/authoring/view-intent/compiler";

function buildViewIntent(input: StageViewIntentToolInput): DashboardViewIntent {
  return {
    view_kind: input.view_kind,
    datasource_id: input.datasource_id,
    table: input.table,
    data_mode: input.data_mode ?? "live",
    fields: input.fields,
    ...(input.sort ? { sort: input.sort } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
    ...(input.filters ? { filters: input.filters } : {}),
    ...(input.mock_data ? { mock_data: input.mock_data } : {}),
    ...(input.mock_value !== undefined ? { mock_value: input.mock_value } : {}),
  };
}
```

Then implement the tool body so it:

```ts
const viewIntent = buildViewIntent(toolInput);
const compilePlan = compileDashboardViewIntent({
  dashboard: beforeDocument,
  viewId,
  title: toolInput.title,
  description: toolInput.description,
  intent: viewIntent,
});
const chartInput = {
  ...toolInput,
  skill_id: compilePlan.recipeId,
};
```

Call the existing transaction path and ensure the upserted view stores:

```ts
view_intent: viewIntent
```

If `stageChartTransaction` cannot currently inject `view_intent`, refactor its upsert call to accept optional `viewIntent?: DashboardViewIntent` and include it in `upsertViewInDocument`.

- [ ] **Step 6: Register `stageViewIntent` in the authoring registry builder**

Modify `src/ai/authoring/tools/registry-builder.ts`:

```ts
import { buildStageViewIntentTool } from "@/ai/authoring/tools/stage-view-intent-tool";
```

Add:

```ts
stageViewIntent: buildStageViewIntentTool({
  dashboard: runtime.dashboard,
  checks: runtime.checks,
  focusedViewId:
    runtime.scope.kind === "focused" ? runtime.scope.viewId : null,
  workingDraft: runtime.workingDraft,
  getActiveGoalId: input.getActiveGoalId,
  markWorkingDraftUpdated: runtime.markWorkingDraftUpdated,
  buildCandidateDocument,
  buildDocumentFingerprint,
  buildDraftStatus: () => runtime.getDraftStatusSnapshot(input.getActiveGoal?.() ?? null),
  getDatasourceSchema: runtime.getDatasourceSchema,
}),
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test --experimental-strip-types tests/authoring-reliability.test.ts
```

Expected: PASS for the new `stageViewIntent` tests.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/ai/authoring/contracts/tool-io.ts src/ai/authoring/tools/schemas.ts src/ai/authoring/tools/stage-view-intent-tool.ts src/ai/authoring/tools/registry-builder.ts tests/authoring-reliability.test.ts
git commit -m "feat: add semantic stage view intent tool"
```

Expected: commit succeeds.

---

### Task 4: Replace Recipe Skills with Semantic Skills

**Files:**
- Create semantic skill markdown files under `src/ai/authoring/skills/`
- Delete recipe skill markdown files under `src/ai/authoring/skills/echarts-*`
- Modify: `src/server/ai/skill-loader.ts`
- Test: `tests/render-input-and-approval.test.ts`

- [ ] **Step 1: Write failing skill catalog tests**

Update `tests/render-input-and-approval.test.ts`:

```ts
test("authoring skill catalog exposes semantic skills and hides renderer recipes", async () => {
  const skills = await listAuthoringSkills();
  const ids = skills.map((skill) => skill.id).sort();

  assert.ok(ids.includes("stat-kpi"));
  assert.ok(ids.includes("time-trend"));
  assert.ok(ids.includes("category-comparison"));
  assert.ok(ids.includes("ranked-bar"));
  assert.ok(ids.includes("signal-list"));
  assert.ok(ids.includes("funnel"));
  assert.ok(ids.includes("bounded-gauge"));
  assert.equal(ids.some((id) => id.startsWith("echarts-")), false);

  const statKpi = await loadAuthoringSkill("stat-kpi");
  assert.ok(statKpi);
  assert.match(statKpi.content, /view_kind: "stat_kpi"/);
  assert.doesNotMatch(statKpi.content, /echarts-/);

  const legacy = await loadAuthoringSkill("echarts-kpi-card");
  assert.equal(legacy, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/render-input-and-approval.test.ts
```

Expected: FAIL because semantic skills do not exist and recipe skills are still exposed.

- [ ] **Step 3: Add semantic skill manuals**

Create `src/ai/authoring/skills/stat-kpi/SKILL.md`:

```md
---
name: stat-kpi
description: Create or revise a single headline metric view. Use for totals, rates, counts, current values, and executive KPI cells.
triggers: [kpi, metric, scorecard, headline, total, rate, count, 指标, 核心指标, 数字卡片]
---

# Stat KPI View Skill

Use this skill when the user needs one headline number.

## Best Fit

- Total sales, total orders, conversion rate, active users, average order value.
- One metric that should be read quickly.
- Executive summary stat cells.

## Avoid

- Time series questions; use `time-trend`.
- Comparing categories or regions; use `category-comparison` or `ranked-bar`.
- Multi-step operational narratives; use `signal-list`.

## stageViewIntent Guidance

- Use `stageViewIntent`.
- Pass `view_kind: "stat_kpi"`.
- Required field mapping:
  - `fields.value.source_field`: numeric source field.
- Common aggregation:
  - `sum` for totals.
  - `avg` for rates or average values.
  - `count` for row counts.

## Runtime Contract

- Do not provide renderer, recipe, layout, style, slots, bindings, or SQL.
- The active Design Kit decides the visual implementation.
```

Create the six other skill manuals with these required `stageViewIntent` lines:

```md
Pass `view_kind: "time_trend"`.
Required field mappings: `fields.time.source_field`, `fields.metric.source_field`.
```

```md
Pass `view_kind: "category_comparison"`.
Required field mappings: `fields.category.source_field`, `fields.metric.source_field`.
```

```md
Pass `view_kind: "ranked_bar"`.
Required field mappings: `fields.category.source_field`, `fields.metric.source_field`.
Use `sort.direction: "desc"` and a small `limit` for top-N requests.
```

```md
Pass `view_kind: "signal_list"`.
Required field mappings: `fields.category.source_field`, `fields.metric.source_field`.
```

```md
Pass `view_kind: "funnel"`.
Required field mappings: `fields.category.source_field`, `fields.metric.source_field`.
```

```md
Pass `view_kind: "bounded_gauge"`.
Required field mapping: `fields.value.source_field`.
Use only for bounded values such as percentages, SLA, progress, or utilization.
```

Every semantic skill must include:

```md
Do not provide renderer, recipe, layout, style, slots, bindings, or SQL.
The active Design Kit decides the visual implementation.
```

- [ ] **Step 4: Delete renderer recipe skill manuals**

Delete the eight `src/ai/authoring/skills/echarts-*/SKILL.md` files listed in the file structure. Keep their `builder.ts` files because they are internal compiler targets.

- [ ] **Step 5: Make `loadAuthoringSkill` reject recipe ids**

Modify `src/server/ai/skill-loader.ts`:

```ts
function isRendererRecipeSkillId(skillName: string): boolean {
  return skillName.startsWith("echarts-");
}
```

At the start of `loadAuthoringSkill`:

```ts
const normalized = skillName.trim();
if (isRendererRecipeSkillId(normalized)) {
  return null;
}
```

Remove design-kit recipe filtering helpers that only apply to `echarts-*` skills.

- [ ] **Step 6: Run skill tests**

Run:

```bash
node --test --experimental-strip-types tests/render-input-and-approval.test.ts
```

Expected: PASS for semantic skill catalog tests.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/ai/authoring/skills src/server/ai/skill-loader.ts tests/render-input-and-approval.test.ts
git commit -m "feat: replace renderer skills with semantic view skills"
```

Expected: commit succeeds.

---

### Task 5: Update Agent Prompt, Goal Declaration, and Tool Surface

**Files:**
- Modify: `src/ai/authoring/messages/system-prompt.ts`
- Modify: `src/ai/authoring/tools/registry.ts`
- Modify: `src/ai/authoring/tools/registry-builder.ts`
- Modify: `src/web/i18n/messages/en.ts`
- Modify: `src/web/i18n/messages/zh.ts`
- Test: `tests/authoring-intent.test.ts`
- Test: `tests/authoring-reliability.test.ts`
- Test: `tests/scope-manager.test.ts`

- [ ] **Step 1: Write failing prompt and tool surface tests**

Add to `tests/authoring-reliability.test.ts`:

```ts
test("authoring tool surface exposes stageViewIntent instead of recipe chart tools", () => {
  const tools = getAuthorToolNamesForScope("dashboard");

  assert.equal(tools.includes("stageViewIntent"), true);
  assert.equal(tools.includes("stageChart"), false);
  assert.equal(tools.includes("stageReplaceChart"), false);
});
```

Add to prompt tests:

```ts
test("authoring prompt describes semantic view selection without renderer recipes", () => {
  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "authoring", "dashboard"],
    scope: { kind: "dashboard" },
    skills: [
      {
        id: "stat-kpi",
        name: "stat-kpi",
        description: "Create a single headline metric view.",
        path: "src/ai/authoring/skills/stat-kpi",
      },
    ],
  });

  assert.match(prompt, /semantic view/i);
  assert.match(prompt, /Design Kit decides the renderer/i);
  assert.doesNotMatch(prompt, /echarts-/);
  assert.doesNotMatch(prompt, /skill_id/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/authoring-reliability.test.ts tests/authoring-intent.test.ts tests/scope-manager.test.ts
```

Expected: FAIL because tool registry and prompt still expose `stageChart`.

- [ ] **Step 3: Replace tool registry entries**

Modify `src/ai/authoring/tools/registry.ts`:

```ts
{ name: "stageViewIntent", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, requiredPermissions: ["dashboard.edit"], labelKey: "authoring.chat.toolLabels.stageViewIntent" },
```

Remove the `stageChart` and `stageReplaceChart` registry rows.

- [ ] **Step 4: Update declaration schema**

In `src/ai/authoring/tools/registry-builder.ts`, change `declareViewGoalSchema`:

```ts
viewKind: Type.Optional(Type.Union([
  Type.Literal("stat_kpi"),
  Type.Literal("time_trend"),
  Type.Literal("category_comparison"),
  Type.Literal("ranked_bar"),
  Type.Literal("signal_list"),
  Type.Literal("funnel"),
  Type.Literal("bounded_gauge"),
])),
```

Remove `chartSkillId` from the schema and from `validateDeclaredChartSkill`. Replace it with `validateDeclaredViewKind` that checks the values against `DASHBOARD_VIEW_KIND_IDS`.

- [ ] **Step 5: Update prompt language**

In `src/ai/authoring/messages/system-prompt.ts`, replace recipe-facing lines with:

```ts
"For report creation, choose one semantic view kind from the available semantic skill metadata. Do not choose renderer recipes.",
"Use semantic skills to decide business fit and required field roles. The active Design Kit decides the renderer implementation.",
"Call stageViewIntent to create or revise a view. Do not provide skill_id, recipe_id, renderer, layout, slots, bindings, SQL, or style tokens.",
"If no available semantic skill matches the requested view, explain that this semantic view kind is not currently supported.",
```

Remove lines that say:

```text
choose one chart skill id
call loadSkill with the matching skill id and then retry stageChart
```

- [ ] **Step 6: Update i18n labels**

In `src/web/i18n/messages/en.ts`:

```ts
stageViewIntent: "Stage view intent",
```

In `src/web/i18n/messages/zh.ts`:

```ts
stageViewIntent: "写入视图意图",
```

Remove `stageChart` and `stageReplaceChart` labels when no code references them.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test --experimental-strip-types tests/authoring-reliability.test.ts tests/authoring-intent.test.ts tests/scope-manager.test.ts
```

Expected: PASS after updating tests that previously asserted `stageChart` availability.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/ai/authoring/messages/system-prompt.ts src/ai/authoring/tools/registry.ts src/ai/authoring/tools/registry-builder.ts src/web/i18n/messages/en.ts src/web/i18n/messages/zh.ts tests/authoring-intent.test.ts tests/authoring-reliability.test.ts tests/scope-manager.test.ts
git commit -m "feat: expose semantic view intent authoring surface"
```

Expected: commit succeeds.

---

### Task 6: Extend Compiler Coverage to All View Kinds

**Files:**
- Modify: `src/contracts/dashboard-view-policy.ts`
- Modify: `src/ai/authoring/view-intent/compiler.ts`
- Test: `tests/dashboard-template.test.ts`
- Test: `tests/authoring-reliability.test.ts`

- [ ] **Step 1: Add failing compiler coverage tests**

Add to `tests/dashboard-template.test.ts`:

```ts
test("compiler maps every semantic view kind to an internal recipe", () => {
  const document = createDashboardFromTemplate();
  const cases = [
    ["stat_kpi", "echarts-kpi-card", { value: { source_field: "gmv", aggregation: "sum" } }],
    ["time_trend", "echarts-line", { time: { source_field: "week_start" }, metric: { source_field: "gmv", aggregation: "sum" } }],
    ["category_comparison", "echarts-bar", { category: { source_field: "region" }, metric: { source_field: "gmv", aggregation: "sum" } }],
    ["ranked_bar", "echarts-ranked-bar", { category: { source_field: "region" }, metric: { source_field: "gmv", aggregation: "sum" } }],
    ["signal_list", "echarts-signal-list", { category: { source_field: "region" }, metric: { source_field: "gmv", aggregation: "sum" } }],
    ["funnel", "echarts-funnel", { category: { source_field: "region" }, metric: { source_field: "gmv", aggregation: "sum" } }],
    ["bounded_gauge", "echarts-kpi-gauge", { value: { source_field: "gmv", aggregation: "avg" } }],
  ] as const;

  for (const [viewKind, recipeId, fields] of cases) {
    const output = compileDashboardViewIntent({
      dashboard: document,
      title: viewKind,
      intent: {
        view_kind: viewKind,
        datasource_id: "testing-db",
        table: "sales_weekly_fact",
        data_mode: "mock",
        fields,
      },
    });
    assert.equal(output.recipeId, recipeId);
    assert.equal(output.renderer.recipe_id, recipeId);
  }
});
```

- [ ] **Step 2: Run test to verify failures**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-template.test.ts
```

Expected: FAIL for any view kind that still has missing field conversion or missing mapping.

- [ ] **Step 3: Update compiler field role mapping**

Ensure `compileDashboardViewIntent` creates the exact result field names expected by current recipe builders:

```ts
const RESULT_FIELD_BY_ROLE = {
  time: "time_value",
  category: "category_value",
  metric: "metric_value",
  value: "value",
  series: "series_value",
} as const;
```

Use that map for every field entry.

- [ ] **Step 4: Run authoring transaction tests for all view kinds**

Add a table-driven test to `tests/authoring-reliability.test.ts` that calls `stageViewIntent` for all seven view kinds with valid fields.

Run:

```bash
node --test --experimental-strip-types tests/authoring-reliability.test.ts
```

Expected: PASS, and each candidate view has `view_intent.view_kind` plus the expected internal `renderer.recipe_id`.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/contracts/dashboard-view-policy.ts src/ai/authoring/view-intent/compiler.ts tests/dashboard-template.test.ts tests/authoring-reliability.test.ts
git commit -m "feat: compile all semantic view kinds"
```

Expected: commit succeeds.

---

### Task 7: Strengthen Validation and Renderer Presentation Checks

**Files:**
- Modify: `src/contracts/validation.ts`
- Modify: `src/renderers/echarts/server/validate-option.ts`
- Test: `tests/dashboard-template.test.ts`

- [ ] **Step 1: Write failing validation tests**

Add to `tests/dashboard-template.test.ts`:

```ts
test("validation rejects renderer recipe that does not match view_intent policy", () => {
  const document = createDashboardFromTemplate();
  const view = makeSimpleView("v_mismatch");
  view.view_intent = {
    view_kind: "stat_kpi",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    data_mode: "mock",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  };
  view.renderer = { ...view.renderer, recipe_id: "echarts-line" };
  document.dashboard_spec.views = [view];

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /renderer.recipe_id does not match semantic view intent/,
  );
});

test("validation rejects recipe body shell chrome duplication", () => {
  const document = createDashboardFromTemplate();
  const view = makeSimpleView("v_duplicate_chrome");
  view.title = "Total sales";
  view.view_intent = {
    view_kind: "stat_kpi",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    data_mode: "mock",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  };
  view.renderer = {
    ...view.renderer,
    recipe_id: "echarts-kpi-card",
    option_template: {
      graphic: [
        { type: "text", style: { text: "Total sales" } },
        { type: "text", style: { text: { $i18n: "kpiCard.badgeLive" } } },
      ],
    },
  };
  document.dashboard_spec.views = [view];

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /recipe body must not duplicate shell chrome/,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-template.test.ts
```

Expected: FAIL because validation does not yet compare recipe mappings or catch i18n status chrome.

- [ ] **Step 3: Validate renderer recipe against policy**

In `src/contracts/validation.ts`, import `getDesignKitViewKindMapping`.

Inside per-view validation, after `view_intent` is known and `renderer.recipe_id` is non-empty:

```ts
const expectedMapping = isRecord(view.view_intent) && typeof view.view_intent.view_kind === "string"
  ? getDesignKitViewKindMapping({
      designKitId,
      viewKind: view.view_intent.view_kind as never,
      viewStyleId: isNonEmptyString(view.view_style_id)
        ? String(view.view_style_id)
        : isRecord(input.presentation) && isNonEmptyString(input.presentation.default_view_style_id)
          ? String(input.presentation.default_view_style_id)
          : "",
    })
  : null;
if (expectedMapping && renderer.recipe_id !== expectedMapping.recipeId) {
  pushIssue(
    issues,
    `${path}.renderer.recipe_id`,
    "renderer.recipe_id does not match semantic view intent",
  );
}
```

- [ ] **Step 4: Detect shell chrome in renderer body**

Add a helper in `src/contracts/validation.ts`:

```ts
function containsShellChromeValue(value: unknown, shellTexts: string[]): boolean {
  if (typeof value === "string") {
    return shellTexts.includes(value) || value === "kpiCard.badgeLive";
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsShellChromeValue(entry, shellTexts));
  }
  if (isRecord(value)) {
    if (value.$i18n === "kpiCard.badgeLive") {
      return true;
    }
    return Object.values(value).some((entry) => containsShellChromeValue(entry, shellTexts));
  }
  return false;
}
```

Use it against `renderer.option_template.graphic`, `renderer.option_template.title`, and `renderer.option_template.series` with shell texts from `view.title` and `view.description`.

When detected, push:

```ts
"recipe body must not duplicate shell chrome"
```

- [ ] **Step 5: Mirror shell chrome detection in server renderer checks**

In `src/renderers/echarts/server/validate-option.ts`, reuse the same recursive detection logic for the presentation check and return:

```ts
{
  target: "presentation",
  status: "error",
  reason: "Renderer duplicates shell chrome.",
  message: "recipe body must not duplicate shell chrome. Rebuild this view from view_intent.",
}
```

- [ ] **Step 6: Run focused validation tests**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-template.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/contracts/validation.ts src/renderers/echarts/server/validate-option.ts tests/dashboard-template.test.ts
git commit -m "test: enforce semantic renderer contract"
```

Expected: commit succeeds.

---

### Task 8: Remove Agent-Visible Recipe Tooling and Update Tests

**Files:**
- Modify or delete recipe-facing authoring tool tests
- Modify: `src/ai/authoring/tools/stage-chart-tool.ts`
- Modify: `src/ai/authoring/tools/stage-replace-chart-tool.ts`
- Modify: `src/ai/authoring/skills/registry.ts`
- Test: `tests/authoring-reliability.test.ts`
- Test: `tests/render-input-and-approval.test.ts`

- [ ] **Step 1: Convert remaining public tests from `stageChart` to `stageViewIntent`**

Search:

```bash
rg -n "stageChart|stageReplaceChart|skill_id|chartSkillId|echarts-" tests src/ai src/server
```

Expected before cleanup: matches exist in tests and implementation.

For tests that validate public agent behavior, replace:

```ts
skill_id: "echarts-kpi-text"
```

with:

```ts
view_kind: "stat_kpi"
```

For line/bar/list/gauge/funnel tests, map:

```ts
echarts-line -> time_trend
echarts-bar -> category_comparison
echarts-ranked-bar -> ranked_bar
echarts-signal-list -> signal_list
echarts-funnel -> funnel
echarts-kpi-gauge -> bounded_gauge
```

- [ ] **Step 2: Remove public registry access to stageChart**

Keep internal builder functions only where `stageViewIntent` still calls shared transaction helpers. Remove any exports that make `stageChart` or `stageReplaceChart` available through `AuthoringTools` or `AUTHORING_TOOL_REGISTRY`.

- [ ] **Step 3: Keep recipe builder registry internal**

In `src/ai/authoring/skills/registry.ts`, rename comments and exported names if needed so it is clear this registry is internal:

```ts
export function getInternalStageChartBuilder(skillId: string): StageChartBuilder | null
```

Update compiler imports to use the internal name. Do not expose the internal registry through skill metadata or loadSkill.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
node --test --experimental-strip-types tests/authoring-reliability.test.ts tests/render-input-and-approval.test.ts tests/authoring-intent.test.ts tests/scope-manager.test.ts
```

Expected: PASS and no public prompt/tool tests mention `stageChart`.

- [ ] **Step 5: Run source leakage check**

Run:

```bash
rg -n "echarts-" src/ai/authoring/skills src/ai/authoring/messages src/server/ai tests/render-input-and-approval.test.ts
```

Expected: no matches in semantic skill manuals, authoring system prompt, or server skill loader tests. Matches in internal builder code are acceptable outside those paths.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/ai/authoring tests src/server/ai
git commit -m "refactor: remove recipe-facing authoring surface"
```

Expected: commit succeeds.

---

### Task 9: Full Verification and Browser Acceptance

**Files:**
- No planned source changes unless verification finds defects.

- [ ] **Step 1: Run type checks**

Run:

```bash
npm run typecheck
npm run typecheck:tests
```

Expected: both PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Start local dev server**

Run:

```bash
npm run dev -- -p 3001
```

Expected: Next dev server starts on `http://localhost:3001`. If port 3001 is occupied, use the next free port and record the URL in the final response.

- [ ] **Step 5: Browser visual acceptance**

In the browser:

1. Create or open an executive report dashboard.
2. Ask the agent to create:
   - a stat KPI for total sales,
   - a time trend for sales by week,
   - a category comparison by region,
   - a signal list for operating signals.
3. Confirm:
   - no skill metadata or tool output asks the agent for `echarts-*`,
   - no narrow/tall legacy KPI text card appears,
   - card title, description, status, selection, resize, and overlays are shell-owned,
   - chart body matches the executive report mock style,
   - saving and publishing do not fail validation.

- [ ] **Step 6: Commit any verification fixes**

If verification required fixes, commit them with:

```bash
git add <changed-files>
git commit -m "fix: close semantic view authoring verification gaps"
```

Expected: no commit is needed if all checks pass cleanly.

---

## Self-Review Checklist

- Spec coverage: semantic skills, `stageViewIntent`, `view_intent`, compiler mapping, Design Kit policy, validation, test coverage, and no legacy compatibility are covered.
- Placeholder scan: no task uses placeholder markers.
- Type consistency: `view_kind`, `view_intent`, `stageViewIntent`, `DashboardViewIntent`, and `DesignKitViewKindMapping` names are consistent across tasks.
- Scope: this is a full authoring boundary refactor. Implementation should start with Tasks 1-3 as a vertical slice before expanding all view kinds.
