import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type {
  BindingResults,
  DashboardDocument,
  DashboardRenderer,
} from "../src/contracts/dashboard.ts";
import type { EChartsStageChartRecipeId } from "../src/contracts/dashboard-chart-recipes.ts";
import type {
  DashboardViewIntent,
  DashboardViewKind,
} from "../src/contracts/dashboard-view-intent.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const {
  DEFAULT_DASHBOARD_TEMPLATE_ID,
  DEFAULT_DASHBOARD_TEMPLATE_VERSION,
  applyDashboardTemplateDefaults,
  createDashboardFromTemplate,
  listDashboardTemplateSummaries,
  resolveDashboardTemplate,
} = await import("../src/presentation/dashboard/templates.ts");
const { resolveTemplateRuntime } = await import(
  "../src/presentation/dashboard/runtime/index.ts"
);
const {
  CANONICAL_DASHBOARD_TEMPLATE_ID,
  CANONICAL_DASHBOARD_TEMPLATE_VERSION,
  listCanonicalDashboardTemplateDefinitions,
  resolveCanonicalDashboardTemplateDefinition,
} = await import("../src/contracts/dashboard-templates.ts");
const {
  createDashboardFromTemplate: createDomainDashboardFromTemplate,
  resolveDashboardTemplate: resolveDomainDashboardTemplate,
} = await import("../src/domain/dashboard/templates.ts");
const {
  dashboardThemeCssVariables,
  getDefaultDashboardColorThemeId,
  getDefaultDashboardDesignKitId,
  getDefaultDashboardViewStyleId,
  listDashboardColorThemes,
  listDashboardDesignKits,
  listDashboardViewStyles,
  resolveDashboardTheme,
} = await import("../src/presentation/dashboard/themes.ts");
const {
  getDesignKitAiVisibleRecipeIds,
  getDesignKitSupportedRecipeIds,
  getRecipePolicyRejection,
  isRecipeSupportedForDesignKit,
} = await import("../src/contracts/dashboard-recipe-policy.ts");
const {
  getDesignKitSupportedViewKinds,
  getDesignKitViewKindMapping,
} = await import("../src/contracts/dashboard-view-policy.ts");
const {
  getTemplateCapability,
  listTemplateSupportedViewKinds,
  resolveCompatibleTemplateCapabilityId,
} = await import("../src/contracts/dashboard-template-capability-registry.ts");
const { compileDashboardViewIntent } = await import(
  "../src/ai/authoring/view-intent/compiler.ts"
);
const { resolveViewPresentationContext } = await import(
  "../src/presentation/dashboard/presentation-context.ts"
);
const {
  DASHBOARD_CHART_LABEL_DEFINITIONS,
  DEFAULT_DASHBOARD_CHART_LABELS,
  dashboardChartLabelMessageKey,
} = await import("../src/presentation/dashboard/chart-i18n.ts");
const { buildDashboardChartLabels } = await import("../src/web/i18n/chart-labels.ts");
const { createTranslator, messagesByLocale } = await import("../src/web/i18n/index.ts");
const { resolveAuthoringPreviewChartPresentation } = await import(
  "../src/web/authoring/api/preview-presentation.ts"
);
const { ensureLayoutMap } = await import("../src/domain/dashboard/document.ts");
const { validateDashboardDocument } = await import("../src/contracts/validation.ts");
const {
  DASHBOARD_VIEW_KIND_IDS,
  createTemporaryDashboardViewIntentForRecipe,
} = await import("../src/contracts/dashboard-view-intent.ts");
const { getTemplatePreviewOption } = await import(
  "../src/renderers/echarts/preview/sample-option.ts"
);
const { validateEChartsOptionOnServer } = await import(
  "../src/renderers/echarts/server/validate-option.ts"
);
const { validateEChartsViewsOnServer } = await import(
  "../src/renderers/echarts/server/validate-option.ts"
);
const { formatRendererSlotValue } = await import(
  "../src/renderers/core/format-slot-value.ts"
);
const {
  buildEChartsBarRecipe,
  buildEChartsRankedBarRecipe,
  buildEChartsFunnelRecipe,
  buildEChartsKpiCardRecipe,
  buildEChartsLineRecipe,
  buildEChartsSignalListRecipe,
} = await import(
  "../src/renderers/echarts/recipes/stage-chart-recipes.ts"
);
const {
  getEChartsStageChartRecipeBuilder,
  listEChartsStageChartRecipeIds,
} = await import("../src/renderers/echarts/recipes/chart-recipe-registry.ts");
const { getInternalStageChartBuilder, listInternalStageChartSkillIds } = await import(
  "../src/ai/authoring/view-intent/internal-stage-chart-builders.ts"
);

const VIEW_KIND_COMPILER_CASES: Array<{
  viewKind: DashboardViewKind;
  recipeId: EChartsStageChartRecipeId;
  fields: DashboardViewIntent["fields"];
}> = [
  {
    viewKind: "stat_kpi",
    recipeId: "echarts-kpi-card",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  },
  {
    viewKind: "time_trend",
    recipeId: "echarts-line",
    fields: {
      time: { source_field: "week_start" },
      metric: { source_field: "gmv", aggregation: "sum" },
    },
  },
  {
    viewKind: "category_comparison",
    recipeId: "echarts-bar",
    fields: {
      category: { source_field: "region" },
      metric: { source_field: "gmv", aggregation: "sum" },
    },
  },
  {
    viewKind: "ranked_bar",
    recipeId: "echarts-ranked-bar",
    fields: {
      category: { source_field: "region" },
      metric: { source_field: "gmv", aggregation: "sum" },
    },
  },
  {
    viewKind: "signal_list",
    recipeId: "echarts-signal-list",
    fields: {
      category: { source_field: "region" },
      metric: { source_field: "gmv", aggregation: "sum" },
    },
  },
  {
    viewKind: "funnel",
    recipeId: "echarts-funnel",
    fields: {
      category: { source_field: "region" },
      metric: { source_field: "gmv", aggregation: "sum" },
    },
  },
  {
    viewKind: "bounded_gauge",
    recipeId: "echarts-kpi-gauge",
    fields: { value: { source_field: "gmv", aggregation: "avg" } },
  },
];

function makeSimpleRenderer(): DashboardRenderer {
  return {
    kind: "echarts",
    recipe_id: "echarts-bar",
    option_template: {
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: [] }],
    },
    slots: [
      { id: "category", path: "xAxis.data", value_kind: "array", required: true },
      { id: "value", path: "series[0].data", value_kind: "array", required: true },
    ],
  };
}

function makeSimpleView(id: string): DashboardDocument["dashboard_spec"]["views"][number] {
  return {
    id,
    title: "Simple View",
    view_intent: {
      view_kind: "category_comparison",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      data_mode: "mock",
      fields: {
        category: { source_field: "region" },
        metric: { source_field: "gmv", aggregation: "sum" },
      },
    },
    renderer: makeSimpleRenderer(),
  };
}

function makeCompiledSemanticViewDocument(input: {
  viewKind: DashboardViewKind;
  fields: DashboardViewIntent["fields"];
  title?: string;
}): DashboardDocument {
  const document = createDashboardFromTemplate();
  const title = input.title ?? `${input.viewKind} shell title`;
  const intent: DashboardViewIntent = {
    view_kind: input.viewKind,
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    data_mode: "mock",
    fields: input.fields,
  };
  const compiled = compileDashboardViewIntent({
    dashboard: document,
    title,
    intent,
  });
  const viewId = `v_${input.viewKind}`;
  document.dashboard_spec.views = [{
    id: viewId,
    title,
    view_intent: intent,
    renderer: compiled.renderer,
  }];
  document.dashboard_spec.layout.desktop = {
    cols: 12,
    row_height: 30,
    items: [{ view_id: viewId, x: 0, y: 0, ...compiled.layout.desktop }],
  };
  document.dashboard_spec.layout.mobile = {
    cols: 4,
    row_height: 30,
    items: [{ view_id: viewId, x: 0, y: 0, ...compiled.layout.mobile }],
  };
  return document;
}

function makeBindingResultsForView(
  view: Pick<DashboardDocument["dashboard_spec"]["views"][number], "id" | "renderer">,
): BindingResults {
  return Object.fromEntries(
    view.renderer.slots.map((slot) => {
      const rows = [
        {
          category_name: "North",
          metric_value: 42,
          series_value: "Actual",
          time_value: "2026-01-05",
        },
      ];
      const data =
        slot.value_kind === "rows"
          ? {
              value: rows,
              rows,
            }
          : {
              value:
                slot.value_kind === "array"
                  ? slot.id === "time"
                    ? ["2026-01-05"]
                    : slot.id === "category"
                      ? ["North"]
                      : [42]
                  : 42,
            };
      return [
        `b_${view.id}_${slot.id}`,
        {
          view_id: view.id,
          slot_id: slot.id,
          query_id: `q_${view.id}`,
          status: "ok" as const,
          data,
        },
      ];
    }),
  );
}

test("default dashboard template creates an empty report shell", () => {
  const document = createDashboardFromTemplate();

  assert.equal(document.dashboard_spec.template?.id, DEFAULT_DASHBOARD_TEMPLATE_ID);
  assert.equal(document.dashboard_spec.template?.version, DEFAULT_DASHBOARD_TEMPLATE_VERSION);
  assert.deepEqual(document.dashboard_spec.presentation, {
    design_kit_id: "operational_report",
    color_theme_id: "purple",
    default_view_style_id: "emphasis",
  });
  assert.equal(document.dashboard_spec.dashboard.name, "Untitled Report");
  assert.equal(document.dashboard_spec.layout.desktop?.cols, 12);
  assert.equal(document.dashboard_spec.layout.mobile?.cols, 4);
  assert.deepEqual(document.dashboard_spec.views, []);
  assert.deepEqual(document.dashboard_spec.layout.desktop?.items, []);
  assert.deepEqual(document.dashboard_spec.layout.mobile?.items, []);
  assert.deepEqual(document.dashboard_spec.filters, []);

  const validation = validateDashboardDocument(document, "save");
  assert.equal(
    validation.ok,
    true,
    validation.ok ? undefined : JSON.stringify(validation.issues),
  );
});

test("dashboard design kit registry resolves the operational report defaults", () => {
  assert.equal(getDefaultDashboardDesignKitId(), "operational_report");
  assert.equal(getDefaultDashboardColorThemeId(), "purple");
  assert.equal(getDefaultDashboardViewStyleId(), "emphasis");
  assert.deepEqual(
    listDashboardDesignKits().map((kit) => kit.id),
    ["operational_report", "executive_report"],
  );
  assert.deepEqual(
    listDashboardColorThemes("operational_report").map((theme) => theme.id),
    ["purple", "teal"],
  );
  assert.deepEqual(
    listDashboardViewStyles("operational_report").map((style) => style.id),
    ["clean", "gradient", "emphasis"],
  );
  assert.equal(
    dashboardThemeCssVariables("teal", "operational_report")["--dashboard-theme-header"],
    resolveDashboardTheme("teal", "operational_report").shell.headerBg,
  );
  assert.equal(
    dashboardThemeCssVariables("purple", "operational_report")["--dashboard-theme-accent-soft"],
    resolveDashboardTheme("purple", "operational_report").chart.currentSoft,
  );
  assert.equal(
    dashboardThemeCssVariables("purple", "operational_report")["--dashboard-density-grid-gap"],
    "16px",
  );
  assert.match(
    dashboardThemeCssVariables("purple", "operational_report")[
      "--dashboard-theme-control-bar-backdrop"
    ],
    /blur/,
  );
});

test("executive report recipe policy hides legacy KPI text from AI creation", () => {
  assert.equal(isRecipeSupportedForDesignKit("executive_report", "echarts-kpi-card"), true);
  assert.equal(isRecipeSupportedForDesignKit("executive_report", "echarts-kpi-text"), false);
  assert.equal(isRecipeSupportedForDesignKit("operational_report", "echarts-kpi-text"), true);
  assert.equal(
    getDesignKitAiVisibleRecipeIds("executive_report").includes("echarts-kpi-text"),
    false,
  );
  assert.equal(
    getDesignKitSupportedRecipeIds("executive_report").includes("echarts-kpi-text"),
    false,
  );
  assert.deepEqual(getRecipePolicyRejection("executive_report", "echarts-kpi-text"), {
    allowed: false,
    recommendedRecipeId: "echarts-kpi-card",
    reason:
      "echarts-kpi-text is a legacy KPI alias and cannot create executive report views.",
  });
});

test("canonical template maps semantic kinds into view families", () => {
  assert.equal(
    listTemplateSupportedViewKinds("report_runtime_v1").includes("time_trend"),
    true,
  );
  assert.deepEqual(getTemplateCapability("report_runtime_v1", "time_trend"), {
    recipeId: "echarts-line",
    bodyContract: "shell_chrome_forbidden",
    viewFamilyId: "trend",
  });
  assert.equal(
    getDesignKitSupportedViewKinds("report_runtime_v1").includes("time_trend"),
    true,
  );
  assert.deepEqual(
    getDesignKitViewKindMapping({
      designKitId: "report_runtime_v1",
      viewKind: "time_trend",
      viewStyleId: "emphasis",
    }),
    {
      recipeId: "echarts-line",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "trend",
    },
  );
});

test("design-kit compatibility bridge stays explicit and rejects unknown ids", () => {
  assert.equal(resolveCompatibleTemplateCapabilityId("operational_report"), "report_runtime_v1");
  assert.equal(resolveCompatibleTemplateCapabilityId("executive_report"), "report_runtime_v1");
  assert.equal(resolveCompatibleTemplateCapabilityId("unknown_runtime"), null);

  assert.deepEqual(
    getDesignKitViewKindMapping({
      designKitId: "operational_report",
      viewKind: "time_trend",
      viewStyleId: "emphasis",
    }),
    {
      recipeId: "echarts-line",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "trend",
    },
  );
  assert.equal(
    getDesignKitViewKindMapping({
      designKitId: "unknown_runtime",
      viewKind: "time_trend",
      viewStyleId: "emphasis",
    }),
    null,
  );
  assert.deepEqual(getDesignKitSupportedViewKinds("unknown_runtime"), []);
});

test("executive report design kit exposes mock-aligned presentation tokens", () => {
  assert.equal(getDefaultDashboardColorThemeId("executive_report"), "purple");
  assert.equal(getDefaultDashboardViewStyleId("executive_report"), "emphasis");
  assert.deepEqual(
    listDashboardColorThemes("executive_report").map((theme) => theme.id),
    ["purple", "teal"],
  );
  assert.deepEqual(
    listDashboardViewStyles("executive_report").map((style) => style.id),
    ["clean", "gradient", "emphasis"],
  );

  const theme = resolveDashboardTheme("purple", "executive_report");
  const cssVariables = dashboardThemeCssVariables("purple", "executive_report");

  assert.equal(theme.designKitId, "executive_report");
  assert.equal(theme.shell.cardBg, "#ffffff");
  assert.equal(theme.shell.cardBorder, "#dfe5ef");
  assert.equal(theme.chart.primary, "#3176d3");
  assert.equal(theme.chart.forecast, "#c78a20");
  assert.equal(cssVariables["--dashboard-density-card-header-padding"], "20px 24px 14px");
  assert.equal(cssVariables["--dashboard-theme-card-radius"], "8px");
  assert.equal(cssVariables["--dashboard-theme-card-selected-outline"], "#1a7cff");
});

test("presentation context resolves design kit, color theme, and view style", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.presentation = {
    design_kit_id: "operational_report",
    color_theme_id: "teal",
    default_view_style_id: "gradient",
  };
  document.dashboard_spec.views = [
    { ...makeSimpleView("v_style"), view_style_id: "clean" },
  ];

  const context = resolveViewPresentationContext(document, { viewId: "v_style" });

  assert.equal(context.designKit.id, "operational_report");
  assert.equal(context.theme.id, "teal");
  assert.equal(context.viewStyle.id, "clean");
  assert.equal(context.chartPresentation.designKitId, "operational_report");
  assert.equal(context.chartPresentation.colorThemeId, "teal");
  assert.equal(context.chartPresentation.viewStyleId, "clean");
  assert.equal(context.isReportSurface, true);
  assert.equal(context.viewFamily?.id, "analysis");
  assert.equal(context.viewFamily?.cardChrome, "chart");
  assert.equal(context.chartPresentation.chartLabels?.["kpiCard.badgeLive"], "Live");
  assert.equal(context.chartPresentation.chartLabels?.["series.actual"], "Actual");
});

test("presentation context prefers dashboard template identity over design-kit fallback", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.template = { id: "unknown_runtime", version: "1" };
  document.dashboard_spec.presentation = {
    design_kit_id: "operational_report",
    color_theme_id: "teal",
    default_view_style_id: "gradient",
  };
  document.dashboard_spec.views = [
    { ...makeSimpleView("v_style"), view_style_id: "clean" },
  ];

  const context = resolveViewPresentationContext(document, { viewId: "v_style" });

  assert.equal(context.viewFamily, null);
});

test("presentation context merges chart labels against dashboard default style", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.presentation = {
    design_kit_id: "operational_report",
    color_theme_id: "purple",
    default_view_style_id: "emphasis",
  };

  const context = resolveViewPresentationContext(document, {
    chartLabels: { "kpiCard.badgeLive": "Live data" },
  });

  assert.equal(context.theme.id, "purple");
  assert.equal(context.viewStyle.id, "emphasis");
  assert.equal(context.chartPresentation.colorThemeId, "purple");
  assert.equal(context.chartPresentation.chartLabels?.["kpiCard.badgeLive"], "Live data");
  assert.equal(context.isReportSurface, true);
});

test("chart label builder derives localized labels from presentation definitions", () => {
  const labelKeys = DASHBOARD_CHART_LABEL_DEFINITIONS.map((definition) => definition.key);

  assert.deepEqual(Object.keys(DEFAULT_DASHBOARD_CHART_LABELS), labelKeys);
  assert.equal(
    buildDashboardChartLabels(createTranslator("en", messagesByLocale))["kpiCard.badgeLive"],
    "Live",
  );
  assert.equal(
    buildDashboardChartLabels(createTranslator("en", messagesByLocale))["series.actual"],
    "Actual",
  );
  assert.equal(
    buildDashboardChartLabels(createTranslator("zh", messagesByLocale))["kpiCard.badgeLive"],
    "实时",
  );
  assert.equal(
    buildDashboardChartLabels(createTranslator("zh", messagesByLocale))["series.actual"],
    "实际值",
  );
  assert.equal(
    buildDashboardChartLabels((key) => key)["kpiCard.badgeLive"],
    "Live",
  );
  assert.equal(
    buildDashboardChartLabels((key) => key)["series.actual"],
    "Actual",
  );
});

function readMessageTreeValue(
  messages: Record<string, unknown>,
  key: string,
): unknown {
  return key.split(".").reduce<unknown>((node, segment) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return undefined;
    }
    return (node as Record<string, unknown>)[segment];
  }, messages);
}

test("chart label definitions derive message keys that exist in locale catalogs", () => {
  for (const definition of DASHBOARD_CHART_LABEL_DEFINITIONS) {
    const messageKey = dashboardChartLabelMessageKey(definition.key);

    assert.equal(messageKey, `chart.${definition.key}`);
    assert.equal(
      readMessageTreeValue(messagesByLocale.en as Record<string, unknown>, messageKey),
      definition.fallback,
    );
    assert.equal(
      typeof readMessageTreeValue(messagesByLocale.zh as Record<string, unknown>, messageKey),
      "string",
    );
    assert.notEqual(
      readMessageTreeValue(messagesByLocale.zh as Record<string, unknown>, messageKey),
      messageKey,
    );
  }
});

test("dashboard chart label refs in graph recipes materialize localized strings", () => {
  const barRecipe = buildEChartsBarRecipe();
  const chartLabels = buildDashboardChartLabels(createTranslator("zh", messagesByLocale));
  const barPreview = getTemplatePreviewOption({
    optionTemplate: barRecipe.renderer.option_template,
    slots: barRecipe.renderer.slots,
    presentation: { chartLabels },
  });

  assert.equal(
    (barPreview.option as { series?: Array<{ name?: string }> }).series?.[0]?.name,
    "实际值",
  );
});

test("authoring preview chart presentation preserves localized chart labels", () => {
  const document = createDashboardFromTemplate();
  const chartPresentation = resolveAuthoringPreviewChartPresentation({
    document,
    chartLabels: buildDashboardChartLabels(createTranslator("zh", messagesByLocale)),
  });

  assert.equal(chartPresentation.colorThemeId, "purple");
  assert.equal(chartPresentation.viewStyleId, "emphasis");
  assert.equal(chartPresentation.chartLabels?.["kpiCard.badgeLive"], "实时");
});

test("dashboard validation only accepts registered design kit presentation ids", () => {
  const validDocument = createDashboardFromTemplate();
  validDocument.dashboard_spec.presentation = {
    design_kit_id: "executive_report",
    color_theme_id: "teal",
    default_view_style_id: "clean",
  };
  assert.equal(validateDashboardDocument(validDocument, "save").ok, true);

  const unknownPresentationDocument = createDashboardFromTemplate();
  unknownPresentationDocument.dashboard_spec.presentation = {
    design_kit_id: "unknown",
    color_theme_id: "custom",
    default_view_style_id: "loud",
  };

  const validation = validateDashboardDocument(unknownPresentationDocument, "save");

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.issues, [
    {
      path: "dashboard_spec.presentation.design_kit_id",
      message: "design_kit_id must be a registered dashboard design kit",
    },
    {
      path: "dashboard_spec.presentation.color_theme_id",
      message: "color_theme_id must be a registered dashboard color theme",
    },
    {
      path: "dashboard_spec.presentation.default_view_style_id",
      message: "default_view_style_id must be a registered dashboard view style",
    },
  ]);
});

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
    } as never,
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

test("dashboard validation rejects invalid view_intent mock data rows", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.views = [
    {
      ...makeSimpleView("v_bad_mock_data"),
      view_intent: {
        ...makeSimpleView("v_bad_mock_data").view_intent,
        mock_data: {
          rows: [
            ["not", "an", "object"],
          ],
        },
      } as never,
    },
  ];

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /view_intent.mock_data.rows\[0\] must be an object/,
  );
});

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
  view.description = "Trailing revenue signal";
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
      title: { text: "Trailing revenue signal" },
      series: [{ type: "bar", name: "Total sales", data: [] }],
    },
    slots: [],
  };
  document.dashboard_spec.views = [view];

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /recipe body must not duplicate shell chrome/,
  );
});

test("temporary semantic view intent strips resolved field internals", () => {
  const intent = createTemporaryDashboardViewIntentForRecipe({
    recipe_id: "echarts-line",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    data_mode: "live",
    time_grain: "week",
    fields: {
      time: {
        source_field: "week_start",
        result_field: "time_value",
        source: "sales_weekly_fact.week_start",
        label: "Week",
        type: "date",
      } as never,
      metric: {
        source_field: "gmv",
        result_field: "metric_value",
        source: "sales_weekly_fact.gmv",
        aggregation: "sum",
      } as never,
    },
  });

  assert.deepEqual(intent.fields.time, {
    source_field: "week_start",
    label: "Week",
    type: "date",
    time_grain: "week",
  });
  assert.deepEqual(intent.fields.metric, {
    source_field: "gmv",
    aggregation: "sum",
  });
  assert.doesNotMatch(JSON.stringify(intent.fields), /result_field|source"/);
});

test("dashboard validation rejects removed presentation fields", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.presentation = {
    ...document.dashboard_spec.presentation,
    theme_id: "removed_theme_id",
    density: "compact",
    card_chrome: "report",
  } as never;

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.deepEqual(
    validation.ok
      ? []
      : validation.issues
          .filter((issue) => issue.message === "removed presentation fields are not supported in schema_version 0.3")
          .map((issue) => issue.path),
    [
      "dashboard_spec.presentation.theme_id",
      "dashboard_spec.presentation.density",
      "dashboard_spec.presentation.card_chrome",
    ],
  );
});

test("template summaries expose selectable report templates", () => {
  const summaries = listDashboardTemplateSummaries();

  assert.deepEqual(
    summaries.map((template) => template.id),
    ["report_runtime_v1"],
  );
  assert.equal(summaries[0]?.cardCount, 0);
  assert.equal(summaries[0]?.filterCount, 0);
  assert.equal(summaries[0]?.accent, "purple");

  const template = resolveDashboardTemplate();
  assert.ok(template.chartRecipeIds.includes("echarts-kpi-card"));
  assert.ok(template.chartRecipeIds.includes("echarts-signal-list"));
  assert.ok(template.chartRecipeIds.includes("echarts-funnel"));
  assert.ok(template.chartRecipeIds.includes("echarts-ranked-bar"));
});

test("canonical template runtime exposes one merged first template", () => {
  const runtime = resolveTemplateRuntime();

  assert.equal(runtime.id, "report_runtime_v1");
  assert.equal(runtime.metadata.badgeKey, "authoring.templates.defaultReport.badge");
  assert.equal(runtime.zeroView.mode, "full_shell");
});

test("contracts-safe canonical template source matches the runtime registry", () => {
  const runtime = resolveTemplateRuntime();
  const template = resolveCanonicalDashboardTemplateDefinition();

  assert.equal(CANONICAL_DASHBOARD_TEMPLATE_ID, "report_runtime_v1");
  assert.equal(CANONICAL_DASHBOARD_TEMPLATE_VERSION, "1");
  assert.equal(template.id, runtime.id);
  assert.equal(template.version, runtime.version);
  assert.equal(template.metadata.badgeKey, runtime.metadata.badgeKey);
});

test("template summaries come from the canonical runtime registry", () => {
  const summaries = listDashboardTemplateSummaries();

  assert.deepEqual(
    summaries.map((summary) => summary.id),
    ["report_runtime_v1"],
  );
  const canonicalTemplate = listCanonicalDashboardTemplateDefinitions()[0];
  assert.equal(summaries[0]?.cardCount, canonicalTemplate?.starter.views.length);
  assert.equal(summaries[0]?.filterCount, canonicalTemplate?.filters.length);
  assert.equal(summaries[0]?.accent, canonicalTemplate?.metadata.accent);
});

test("template summary refs round-trip through canonical template resolution", () => {
  const summary = listDashboardTemplateSummaries()[0];

  assert.ok(summary);

  const presentationTemplate = resolveDashboardTemplate(summary.ref);
  const domainTemplate = resolveDomainDashboardTemplate(summary.ref);
  const presentationDocument = createDashboardFromTemplate(summary.ref);
  const domainDocument = createDomainDashboardFromTemplate(summary.ref);

  assert.equal(presentationTemplate.id, summary.id);
  assert.equal(domainTemplate.id, summary.id);
  assert.equal(presentationDocument.dashboard_spec.template?.id, summary.id);
  assert.equal(domainDocument.dashboard_spec.template?.id, summary.id);
});

test("dashboard template chart recipes resolve to registered stageChart builders", () => {
  const missingRecipeIds = listDashboardTemplateSummaries().flatMap((summary) => {
    const template = resolveDashboardTemplate(summary.ref);
    return template.chartRecipeIds.filter((recipeId) => !getInternalStageChartBuilder(recipeId));
  });

  assert.deepEqual(missingRecipeIds, []);
});

test("dashboard template chart recipes resolve to registered renderer recipes", () => {
  const template = resolveDashboardTemplate();

  assert.deepEqual(listEChartsStageChartRecipeIds(), template.chartRecipeIds);
  assert.deepEqual(
    template.chartRecipeIds.filter((recipeId) => !getEChartsStageChartRecipeBuilder(recipeId)),
    [],
  );
});

test("template preview returns a fully materialized responsive ECharts option", () => {
  const preview = getTemplatePreviewOption({
    optionTemplate: {
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: [] }],
    },
    slots: [],
  });
  const option = preview.option as {
    grid: { containLabel: boolean };
    tooltip: { confine: boolean };
    series: Array<{ barMaxWidth?: number }>;
  };

  assert.equal(option.grid.containLabel, true);
  assert.equal(option.tooltip.confine, true);
  assert.equal(option.series[0]?.barMaxWidth, 52);
});

test("template preview applies renderer transforms for multi-series recipes", () => {
  const recipe = buildEChartsLineRecipe({
    title: "Returns",
    fields: {
      series: {
        source_field: "return_type",
        result_field: "series_value",
      },
      time: {
        source_field: "return_date",
        result_field: "time_value",
      },
      metric: {
        source_field: "return_count",
        result_field: "metric_value",
      },
    },
  });

  const preview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
  });
  const option = preview.option as {
    dataset: { source: unknown[][] };
    series: Array<{ name: string; type: string; encode: Record<string, string> }>;
  };

  assert.deepEqual(option.dataset.source[0], [
    "time_value",
    "Series A",
    "Series B",
  ]);
  assert.equal(option.dataset.source.length, 10);
  assert.deepEqual(
    option.series.map((series) => series.name),
    ["Series A", "Series B"],
  );
  assert.ok(option.series.every((series) => series.type === "line"));
  assert.equal(preview.rowsCount, 18);
});

test("line recipe degrades incomplete series input instead of throwing", () => {
  const recipe = buildEChartsLineRecipe({
    title: "Returns",
    fields: {
      series: {
        source_field: "return_type",
        result_field: "series_value",
      },
    },
  });

  assert.equal(recipe.renderer.transforms, undefined);
  assert.deepEqual(
    recipe.bindings.map((binding) => binding.field_role),
    ["time", "metric"],
  );
});

test("template preview keeps category and value samples aligned", () => {
  const recipe = buildEChartsBarRecipe();
  const preview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
  });
  const option = preview.option as {
    xAxis: { data: unknown[] };
    series: Array<{ data: unknown[] }>;
  };

  assert.equal(option.xAxis.data.length, option.series[0]?.data.length);
  assert.equal(preview.rowsCount, option.xAxis.data.length);
});

test("ECharts recipe theme tokens materialize against the selected theme", () => {
  const recipe = buildEChartsBarRecipe();
  const purplePreview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
    presentation: { colorThemeId: "purple", designKitId: "operational_report" },
  });
  const tealPreview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
    presentation: { colorThemeId: "teal", designKitId: "operational_report" },
  });
  const purpleOption = purplePreview.option as {
    color: string[];
    series: Array<{ itemStyle: { color: string } }>;
  };
  const tealOption = tealPreview.option as {
    color: string[];
    series: Array<{ itemStyle: { color: string } }>;
  };

  assert.equal(purpleOption.color[0], resolveDashboardTheme("purple").chart.primary);
  assert.equal(tealOption.color[0], resolveDashboardTheme("teal").chart.primary);
  assert.equal(tealOption.series[0]?.itemStyle.color, resolveDashboardTheme("teal").chart.primary);
  assert.notEqual(purpleOption.color[0], tealOption.color[0]);
});

test("view styles materialize into visibly different ECharts options", () => {
  const recipe = buildEChartsLineRecipe({
    title: "Revenue trend",
    fields: {
      time: { source_field: "week", result_field: "time_value" },
      metric: { source_field: "revenue", result_field: "metric_value" },
    },
  });
  const cleanPreview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
    presentation: { viewStyleId: "clean" },
  });
  const emphasisPreview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
    presentation: { viewStyleId: "emphasis" },
  });
  const cleanOption = cleanPreview.option as {
    series: Array<{ smooth?: boolean; symbolSize?: number; areaStyle?: { opacity?: number } }>;
  };
  const emphasisOption = emphasisPreview.option as {
    series: Array<{ smooth?: boolean; symbolSize?: number; areaStyle?: { opacity?: number } }>;
  };

  assert.equal(cleanOption.series[0]?.smooth, false);
  assert.equal(cleanOption.series[0]?.areaStyle?.opacity, 0);
  assert.equal(emphasisOption.series[0]?.smooth, true);
  assert.equal(emphasisOption.series[0]?.symbolSize, 7);
  assert.notDeepEqual(cleanOption.series[0], emphasisOption.series[0]);
});

test("non-line report recipes honor view style presets", () => {
  const dashboard = createDashboardFromTemplate();
  const cleanKpiRecipe = buildEChartsKpiCardRecipe({
    title: "Revenue",
    presentation: resolveViewPresentationContext(dashboard, { viewStyleId: "clean" }),
    fields: {
      value: { source_field: "revenue", result_field: "metric_value" },
    },
  });
  const emphasisKpiRecipe = buildEChartsKpiCardRecipe({
    title: "Revenue",
    presentation: resolveViewPresentationContext(dashboard, { viewStyleId: "emphasis" }),
    fields: {
      value: { source_field: "revenue", result_field: "metric_value" },
    },
  });
  const cleanKpi = getTemplatePreviewOption({
    optionTemplate: cleanKpiRecipe.renderer.option_template,
    slots: cleanKpiRecipe.renderer.slots,
    transforms: cleanKpiRecipe.renderer.transforms,
  }).option as { graphic: Array<{ style?: { fontSize?: number; shadowBlur?: number } }> };
  const emphasisKpi = getTemplatePreviewOption({
    optionTemplate: emphasisKpiRecipe.renderer.option_template,
    slots: emphasisKpiRecipe.renderer.slots,
    transforms: emphasisKpiRecipe.renderer.transforms,
  }).option as { graphic: Array<{ style?: { fontSize?: number; shadowBlur?: number } }> };

  assert.equal(cleanKpi.graphic[1]?.style?.fontSize, 30);
  assert.equal(emphasisKpi.graphic[1]?.style?.fontSize, 36);
  assert.notDeepEqual(cleanKpi.graphic, emphasisKpi.graphic);

  const funnelRecipe = buildEChartsFunnelRecipe({
    title: "Conversion",
    fields: {
      category: { source_field: "stage", result_field: "category_name" },
      metric: { source_field: "sessions", result_field: "metric_value" },
    },
  });
  const cleanFunnel = getTemplatePreviewOption({
    optionTemplate: funnelRecipe.renderer.option_template,
    slots: funnelRecipe.renderer.slots,
    transforms: funnelRecipe.renderer.transforms,
    presentation: { viewStyleId: "clean" },
  }).option as { series: Array<{ barWidth?: number; showBackground?: boolean; itemStyle?: { borderRadius?: number } }> };
  const emphasisFunnel = getTemplatePreviewOption({
    optionTemplate: funnelRecipe.renderer.option_template,
    slots: funnelRecipe.renderer.slots,
    transforms: funnelRecipe.renderer.transforms,
    presentation: { viewStyleId: "emphasis" },
  }).option as { series: Array<{ barWidth?: number; showBackground?: boolean; itemStyle?: { borderRadius?: number } }> };

  assert.equal(cleanFunnel.series[0]?.barWidth, 12);
  assert.equal(cleanFunnel.series[0]?.showBackground, true);
  assert.equal(cleanFunnel.series[0]?.itemStyle?.borderRadius, 999);
  assert.equal(emphasisFunnel.series[0]?.barWidth, 12);
  assert.equal(emphasisFunnel.series[0]?.showBackground, true);
  assert.equal(emphasisFunnel.series[0]?.itemStyle?.borderRadius, 999);

  const signalRecipe = buildEChartsSignalListRecipe({
    title: "Signals",
    fields: {
      category: { source_field: "signal", result_field: "category_name" },
      metric: { source_field: "score", result_field: "metric_value" },
    },
  });
  const cleanSignal = getTemplatePreviewOption({
    optionTemplate: signalRecipe.renderer.option_template,
    slots: signalRecipe.renderer.slots,
    transforms: signalRecipe.renderer.transforms,
    presentation: { viewStyleId: "clean" },
  }).option as { series: Array<{ barMaxWidth?: number; showBackground?: boolean }> };
  const emphasisSignal = getTemplatePreviewOption({
    optionTemplate: signalRecipe.renderer.option_template,
    slots: signalRecipe.renderer.slots,
    transforms: signalRecipe.renderer.transforms,
    presentation: { viewStyleId: "emphasis" },
  }).option as { series: Array<{ barMaxWidth?: number; showBackground?: boolean }> };

  assert.equal(cleanSignal.series[0]?.barMaxWidth, 16);
  assert.equal(cleanSignal.series[0]?.showBackground, false);
  assert.equal(emphasisSignal.series[0]?.barMaxWidth, 24);
  assert.equal(emphasisSignal.series[0]?.showBackground, true);
});

test("KPI card recipe leaves card title, description, and status to the report shell", () => {
  const recipe = buildEChartsKpiCardRecipe({
    title: "销售额总览",
    description: "汇总销售额（GMV）",
    fields: {
      value: { source_field: "gmv", result_field: "metric_value" },
    },
  });
  const graphicText = JSON.stringify(recipe.renderer.option_template.graphic);

  assert.equal(recipe.renderer.slots[0]?.path, "graphic[1].style.text");
  assert.doesNotMatch(graphicText, /销售额总览/);
  assert.doesNotMatch(graphicText, /汇总销售额/);
  assert.doesNotMatch(graphicText, /kpiCard\.badgeLive/);
});

test("executive report KPI card recipe uses stat-cell proportions", () => {
  const dashboard = createDashboardFromTemplate();
  dashboard.dashboard_spec.presentation = {
    design_kit_id: "executive_report",
    color_theme_id: "purple",
    default_view_style_id: "emphasis",
  };
  const recipe = buildEChartsKpiCardRecipe({
    title: "Revenue",
    presentation: resolveViewPresentationContext(dashboard),
    fields: {
      value: { source_field: "revenue", result_field: "metric_value" },
    },
  });
  const preview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
  }).option as { graphic: Array<{ top?: number; bottom?: number; style?: { fontSize?: number; fontWeight?: number } }> };

  assert.equal(recipe.layout.desktop.h, 2);
  assert.equal(recipe.renderer.slots[0]?.path, "graphic[1].style.text");
  assert.equal(recipe.renderer.slots[0]?.formatter, "compact_number");
  assert.equal(preview.graphic[1]?.style?.fontSize, 38);
  assert.equal(preview.graphic[1]?.top, 18);
  assert.equal(preview.graphic.length, 2);
});

test("executive report KPI formats large values compactly to avoid clipping", () => {
  assert.equal(formatRendererSlotValue(11559600, "compact_number"), "11.6M");
  assert.equal(formatRendererSlotValue(482400, "compact_number"), "482.4K");
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
  assert.equal(output.renderer.slots[0]?.path, "graphic[1].style.text");
  assert.equal(output.layout.desktop.w, 3);
  assert.equal(output.layout.desktop.h, 2);

  const viewId = "v_total_sales";
  document.dashboard_spec.views = [{
    id: viewId,
    title: "Total sales",
    view_intent: {
      view_kind: "stat_kpi",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      data_mode: "mock",
      fields: {
        value: { source_field: "gmv", aggregation: "sum" },
      },
    },
    renderer: output.renderer,
  }];
  document.dashboard_spec.layout.desktop = {
    cols: 12,
    row_height: 30,
    items: [{ view_id: viewId, x: 0, y: 0, ...output.layout.desktop }],
  };
  document.dashboard_spec.layout.mobile = {
    cols: 4,
    row_height: 30,
    items: [{ view_id: viewId, x: 0, y: 0, ...output.layout.mobile }],
  };

  const validation = validateDashboardDocument(document, "save");
  assert.equal(
    validation.ok,
    true,
    validation.ok
      ? undefined
      : validation.issues.map((issue) => issue.message).join("\n"),
  );
});

test("compiler emits category comparison renderer from semantic intent", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.presentation = {
    design_kit_id: "executive_report",
    color_theme_id: "purple",
    default_view_style_id: "emphasis",
  };

  const output = compileDashboardViewIntent({
    dashboard: document,
    title: "Revenue by region",
    intent: {
      view_kind: "category_comparison",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      data_mode: "mock",
      fields: {
        category: { source_field: "region", label: "Region" },
        metric: { source_field: "gmv", aggregation: "sum" },
      },
    },
  });

  assert.equal(output.recipeId, "echarts-bar");
  assert.deepEqual(
    output.renderer.slots.map((slot) => slot.id),
    ["category", "value"],
  );
  assert.deepEqual(
    output.bindings.map((binding) => [binding.slot_id, binding.field_role]),
    [
      ["category", "category"],
      ["value", "metric"],
    ],
  );
});

test("compiler follows dashboard template identity before presentation design kit", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.template = { id: "unknown_runtime", version: "1" };
  document.dashboard_spec.presentation = {
    design_kit_id: "executive_report",
    color_theme_id: "purple",
    default_view_style_id: "emphasis",
  };

  assert.throws(
    () =>
      compileDashboardViewIntent({
        dashboard: document,
        title: "Revenue by region",
        intent: {
          view_kind: "category_comparison",
          datasource_id: "testing-db",
          table: "sales_weekly_fact",
          data_mode: "mock",
          fields: {
            category: { source_field: "region", label: "Region" },
            metric: { source_field: "gmv", aggregation: "sum" },
          },
        },
      }),
    /unsupported_view_kind: category_comparison is not supported/i,
  );
});

test("compiler maps every semantic view kind to an internal recipe", () => {
  const document = createDashboardFromTemplate();

  assert.deepEqual(
    VIEW_KIND_COMPILER_CASES.map((item) => item.viewKind),
    [...DASHBOARD_VIEW_KIND_IDS],
  );

  for (const { viewKind, recipeId, fields } of VIEW_KIND_COMPILER_CASES) {
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

test("compiler output passes semantic renderer contract validation for every view kind", () => {
  for (const { viewKind, fields } of VIEW_KIND_COMPILER_CASES) {
    const document = makeCompiledSemanticViewDocument({
      viewKind,
      fields,
    });

    const validation = validateDashboardDocument(document, "save");

    assert.equal(
      validation.ok,
      true,
      validation.ok
        ? undefined
        : validation.issues.map((issue) => issue.message).join("\n"),
    );
  }
});

test("executive report chart recipes use mock-aligned graph presets", () => {
  const dashboard = createDashboardFromTemplate();
  dashboard.dashboard_spec.presentation = {
    design_kit_id: "executive_report",
    color_theme_id: "purple",
    default_view_style_id: "emphasis",
  };
  const presentation = resolveViewPresentationContext(dashboard);
  const categoryMetricInput = {
    title: "Operating signals",
    presentation,
    fields: {
      category: { source_field: "region", result_field: "category_name" },
      metric: { source_field: "revenue", result_field: "metric_value" },
    },
  };
  const barRecipe = buildEChartsBarRecipe({ presentation });
  const lineRecipe = buildEChartsLineRecipe({
    title: "Revenue trend",
    presentation,
    fields: {
      category: { source_field: "week", result_field: "category_name" },
      metric: { source_field: "revenue", result_field: "metric_value" },
    },
  });
  const signalRecipe = buildEChartsSignalListRecipe(categoryMetricInput);

  const barOption = getTemplatePreviewOption({
    optionTemplate: barRecipe.renderer.option_template,
    slots: barRecipe.renderer.slots,
    transforms: barRecipe.renderer.transforms,
    presentation: { designKitId: "executive_report", colorThemeId: "purple" },
  }).option as {
    color?: string[];
    grid?: { left?: number; right?: number };
    series: Array<{
      barMaxWidth?: number;
      barCategoryGap?: string;
      itemStyle?: { borderRadius?: number[]; shadowBlur?: number };
    }>;
  };
  const lineOption = getTemplatePreviewOption({
    optionTemplate: lineRecipe.renderer.option_template,
    slots: lineRecipe.renderer.slots,
    transforms: lineRecipe.renderer.transforms,
    presentation: { designKitId: "executive_report", colorThemeId: "purple" },
  }).option as { series: Array<{ symbolSize?: number; lineStyle?: { width?: number } }> };
  const signalOption = getTemplatePreviewOption({
    optionTemplate: signalRecipe.renderer.option_template,
    slots: signalRecipe.renderer.slots,
    transforms: signalRecipe.renderer.transforms,
    presentation: { designKitId: "executive_report", colorThemeId: "purple" },
  }).option as { series: Array<{ backgroundStyle?: { color?: string }; itemStyle?: { color?: string } }> };

  assert.deepEqual(barOption.color, ["#3176d3", "#c78a20"]);
  assert.equal(barOption.grid?.left, 46);
  assert.equal(barOption.grid?.right, 34);
  assert.equal(barOption.series[0]?.barMaxWidth, 42);
  assert.equal(barOption.series[0]?.barCategoryGap, "44%");
  assert.deepEqual(barOption.series[0]?.itemStyle?.borderRadius, [7, 7, 0, 0]);
  assert.equal(barOption.series[0]?.itemStyle?.shadowBlur, undefined);
  assert.equal(lineOption.series[0]?.symbolSize, 5);
  assert.equal(lineOption.series[0]?.lineStyle?.width, 2);
  assert.equal(signalOption.series[0]?.backgroundStyle?.color, "#eef2f7");
  assert.equal(signalOption.series[0]?.itemStyle?.color, "#5b2e91");
});

test("horizontal report bars preserve ranked bar geometry during materialization", () => {
  const recipe = buildEChartsRankedBarRecipe({
    title: "Region rank",
    fields: {
      category: { source_field: "region", result_field: "category_name" },
      metric: { source_field: "revenue", result_field: "metric_value" },
    },
  });
  const preview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
    presentation: { viewStyleId: "emphasis" },
  });
  const option = preview.option as {
    series: Array<{ barMaxWidth?: number; itemStyle?: { borderRadius?: number[] } }>;
  };

  assert.equal(option.series[0]?.barMaxWidth, 24);
  assert.deepEqual(option.series[0]?.itemStyle?.borderRadius, [0, 8, 8, 0]);
});

test("materialized report ECharts option validates on the server with selected theme", async () => {
  const recipe = buildEChartsBarRecipe();
  const preview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
    presentation: { colorThemeId: "teal", designKitId: "operational_report" },
  });
  const validation = await validateEChartsOptionOnServer(preview.option);

  assert.equal(validation.status, "ok", validation.message);
  assert.doesNotMatch(JSON.stringify(preview.option), /\$theme|\$i18n/);
});

test("bar recipe chart series labels materialize from locale overrides", () => {
  const recipe = buildEChartsBarRecipe();
  const preview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
    presentation: {
      chartLabels: {
        "series.actual": "实际值",
      },
    },
  });
  const option = preview.option as { series?: Array<{ name?: string }> };

  assert.match(JSON.stringify(recipe.renderer.option_template), /"\$i18n":"series\.actual"/);
  assert.equal(option.series?.[0]?.name, "实际值");
});

test("contract validation rejects removed KPI slot paths", () => {
  const renderer = {
    kind: "echarts",
    recipe_id: "echarts-bar",
    option_template: {
      graphic: [
        { type: "text", style: { text: "Revenue" } },
        { type: "text", style: { text: "0" } },
      ],
    },
    slots: [
      {
        id: "value",
        path: "graphic[0].style.text",
        value_kind: "scalar",
        required: true,
      },
    ],
  } satisfies DashboardRenderer;
  const document = createDashboardFromTemplate();
  document.dashboard_spec.views = [{
    id: "v_removed_slot",
    title: "Removed KPI slot",
    view_intent: createTemporaryDashboardViewIntentForRecipe({
      recipe_id: "echarts-bar",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      data_mode: "mock",
      fields: {},
    }),
    renderer,
  }];

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /removed KPI value slot path is not supported/,
  );
});

test("executive report validation allows resized modern KPI cards", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.presentation = {
    design_kit_id: "executive_report",
    color_theme_id: "purple",
    default_view_style_id: "emphasis",
  };
  const intent: DashboardViewIntent = {
    view_kind: "stat_kpi",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    data_mode: "mock",
    fields: {
      value: { source_field: "gmv", aggregation: "sum" },
    },
  };
  const compiled = compileDashboardViewIntent({
    dashboard: document,
    title: "总 GMV",
    intent,
  });
  document.dashboard_spec.views = [{
    id: "v_total_gmv",
    title: "总 GMV",
    view_intent: intent,
    renderer: compiled.renderer,
  }];
  document.dashboard_spec.layout.desktop = {
    cols: 12,
    row_height: 30,
    items: [{ view_id: "v_total_gmv", x: 0, y: 0, w: 3, h: 6 }],
  };
  document.dashboard_spec.layout.mobile = {
    cols: 4,
    row_height: 30,
    items: [{ view_id: "v_total_gmv", x: 0, y: 0, w: 4, h: 6 }],
  };

  const validation = validateDashboardDocument(document, "save");

  assert.equal(
    validation.ok,
    true,
    validation.ok
      ? undefined
      : validation.issues.map((issue) => issue.message).join("\n"),
  );
});

test("executive report validation rejects legacy KPI text body chrome", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.presentation = {
    design_kit_id: "executive_report",
    color_theme_id: "purple",
    default_view_style_id: "emphasis",
  };
  document.dashboard_spec.views = [
    {
      id: "v_legacy_kpi_text",
      title: "订单数",
      description: "使用 mock 数据的 KPI 文本卡示例。",
      view_intent: createTemporaryDashboardViewIntentForRecipe({
        recipe_id: "echarts-kpi-text",
        datasource_id: "testing-db",
        table: "sales_weekly_fact",
        data_mode: "mock",
        fields: {
          value: {
            source_field: "orders",
            aggregation: "sum",
          },
        },
      }),
      renderer: {
        kind: "echarts",
        recipe_id: "echarts-kpi-text",
        option_template: {
          graphic: [
            { type: "text", style: { text: "订单数" } },
            { type: "text", style: { text: "0" } },
            { type: "text", style: { text: "使用 mock 数据的 KPI 文本卡示例。" } },
          ],
        },
        slots: [
          { id: "value", path: "graphic[1].style.text", value_kind: "scalar", required: true },
        ],
      },
    },
  ];
  document.dashboard_spec.layout.desktop = {
    cols: 12,
    row_height: 30,
    items: [{ view_id: "v_legacy_kpi_text", x: 0, y: 0, w: 3, h: 7 }],
  };
  document.dashboard_spec.layout.mobile = {
    cols: 4,
    row_height: 30,
    items: [{ view_id: "v_legacy_kpi_text", x: 0, y: 0, w: 4, h: 7 }],
  };

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /not supported for executive_report/,
  );
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /must not duplicate shell title or description/,
  );
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /uses a legacy KPI text layout/,
  );
});

test("contract validation rejects hardcoded ECharts colors", () => {
  const document = createDashboardFromTemplate();
  const renderer = {
    kind: "echarts",
    recipe_id: "echarts-bar",
    option_template: {
      color: "#123456",
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: [] }],
    },
    slots: [
      { id: "category", path: "xAxis.data", value_kind: "array", required: true },
      { id: "value", path: "series[0].data", value_kind: "array", required: true },
    ],
  } satisfies DashboardRenderer;
  document.dashboard_spec.views = [{
    id: "v_hardcoded",
    title: "Hardcoded",
    view_intent: createTemporaryDashboardViewIntentForRecipe({
      recipe_id: "echarts-bar",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      data_mode: "mock",
      fields: {},
    }),
    renderer,
  }];

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /must use dashboard theme tokens instead of hardcoded ECharts colors/,
  );
});

test("contract validation rejects missing and unknown renderer recipe ids", () => {
  const missingRecipeDocument = createDashboardFromTemplate();
  missingRecipeDocument.dashboard_spec.views = [
    {
      ...makeSimpleView("v_missing_recipe"),
      renderer: {
        ...makeSimpleView("v_missing_recipe").renderer,
        recipe_id: undefined,
      } as never,
    },
  ];
  const unknownRecipeDocument = createDashboardFromTemplate();
  unknownRecipeDocument.dashboard_spec.views = [
    {
      ...makeSimpleView("v_unknown_recipe"),
      renderer: {
        ...makeSimpleView("v_unknown_recipe").renderer,
        recipe_id: "removed-recipe-id",
      } as never,
    },
  ];

  const missingValidation = validateDashboardDocument(missingRecipeDocument, "save");
  const unknownValidation = validateDashboardDocument(unknownRecipeDocument, "save");

  assert.equal(missingValidation.ok, false);
  assert.match(
    missingValidation.ok
      ? ""
      : missingValidation.issues.map((issue) => issue.message).join("\n"),
    /renderer\.recipe_id must be a non-empty string/,
  );
  assert.equal(unknownValidation.ok, false);
  assert.match(
    unknownValidation.ok
      ? ""
      : unknownValidation.issues.map((issue) => issue.message).join("\n"),
    /renderer\.recipe_id must be a registered ECharts recipe/,
  );
});

test("server renderer checks pass presentation contract for valid report KPI", async () => {
  const document = createDashboardFromTemplate();
  const recipe = buildEChartsKpiCardRecipe({
    title: "Revenue",
    fields: {
      value: {
        source_field: "revenue",
        result_field: "metric_value",
      },
    },
  });
  document.dashboard_spec.views = [{
    id: "v_report",
    title: "Revenue",
    view_intent: createTemporaryDashboardViewIntentForRecipe({
      recipe_id: "echarts-kpi-card",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      data_mode: "mock",
      fields: {
        value: {
          source_field: "revenue",
          aggregation: "sum",
        },
      },
    }),
    renderer: recipe.renderer,
  }];

  const checks = await validateEChartsViewsOnServer({
    document,
    visibleViewIds: ["v_report"],
    bindingResults: {
      b_value: {
        view_id: "v_report",
        slot_id: "value",
        query_id: "q_report",
        status: "ok",
        data: { value: 42 },
      },
    },
  });

  assert.equal(checks.v_report?.server?.status, "ok");
  assert.equal(checks.v_report?.presentation?.status, "ok");
});

test("server renderer checks pass presentation contract for compiled semantic views", async () => {
  for (const { viewKind, fields } of VIEW_KIND_COMPILER_CASES) {
    const document = makeCompiledSemanticViewDocument({
      viewKind,
      fields,
    });
    const view = document.dashboard_spec.views[0];
    if (!view) {
      throw new Error(`Missing compiled view for ${viewKind}`);
    }

    const checks = await validateEChartsViewsOnServer({
      document,
      visibleViewIds: [view.id],
      bindingResults: makeBindingResultsForView(view),
    });

    assert.equal(
      checks[view.id]?.presentation?.status,
      "ok",
      `${viewKind}: ${checks[view.id]?.presentation?.message ?? "no message"}`,
    );
  }
});

test("server renderer checks flag recipe body shell chrome duplication", async () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.views = [
    {
      id: "v_duplicate",
      title: "Revenue",
      description: "Live performance",
      view_intent: createTemporaryDashboardViewIntentForRecipe({
        recipe_id: "echarts-kpi-card",
        datasource_id: "testing-db",
        table: "sales_weekly_fact",
        data_mode: "mock",
        fields: {
          value: {
            source_field: "revenue",
            aggregation: "sum",
          },
        },
      }),
      renderer: {
        kind: "echarts",
        recipe_id: "echarts-kpi-card",
        option_template: {
          graphic: [
            { type: "text", style: { text: "Revenue" } },
            { type: "text", style: { text: { $i18n: "kpiCard.badgeLive" } } },
          ],
          title: { text: "Live performance" },
          series: [{ type: "bar", name: "Revenue", data: [] }],
        },
        slots: [],
      },
    },
  ];

  const checks = await validateEChartsViewsOnServer({
    document,
    visibleViewIds: ["v_duplicate"],
    bindingResults: {},
  });

  assert.equal(checks.v_duplicate?.presentation?.status, "error");
  assert.equal(
    checks.v_duplicate?.presentation?.message,
    "recipe body must not duplicate shell chrome. Rebuild this view from view_intent.",
  );
});

test("server renderer checks do not throw for legacy views without semantic intent", async () => {
  const document = createDashboardFromTemplate();
  const legacyView = {
    ...makeSimpleView("v_legacy_without_intent"),
  } as Omit<DashboardDocument["dashboard_spec"]["views"][number], "view_intent"> & {
    view_intent?: unknown;
  };
  delete legacyView.view_intent;
  document.dashboard_spec.views = [legacyView as never];

  const checks = await validateEChartsViewsOnServer({
    document,
    visibleViewIds: [legacyView.id],
    bindingResults: makeBindingResultsForView(legacyView),
  });

  assert.equal(checks.v_legacy_without_intent?.presentation?.status, "ok");
});

test("server renderer checks flag executive report legacy KPI body", async () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.presentation = {
    design_kit_id: "executive_report",
    color_theme_id: "purple",
    default_view_style_id: "emphasis",
  };
  document.dashboard_spec.views = [
    {
      id: "v_legacy",
      title: "订单数",
      description: "使用 mock 数据的 KPI 文本卡示例。",
      view_intent: createTemporaryDashboardViewIntentForRecipe({
        recipe_id: "echarts-kpi-text",
        datasource_id: "testing-db",
        table: "sales_weekly_fact",
        data_mode: "mock",
        fields: {
          value: {
            source_field: "orders",
            aggregation: "sum",
          },
        },
      }),
      renderer: {
        kind: "echarts",
        recipe_id: "echarts-kpi-text",
        option_template: {
          graphic: [
            { type: "text", style: { text: "订单数" } },
            { type: "text", style: { text: "0" } },
            { type: "text", style: { text: "使用 mock 数据的 KPI 文本卡示例。" } },
          ],
        },
        slots: [
          { id: "value", path: "graphic[1].style.text", value_kind: "scalar", required: true },
        ],
      },
    },
  ];

  const checks = await validateEChartsViewsOnServer({
    document,
    visibleViewIds: ["v_legacy"],
    bindingResults: {
      b_value: {
        view_id: "v_legacy",
        slot_id: "value",
        query_id: "q_legacy",
        status: "ok",
        data: { value: 42 },
      },
    },
  });

  assert.equal(checks.v_legacy?.presentation?.status, "error");
  assert.match(checks.v_legacy?.presentation?.message ?? "", /echarts-kpi-card/);
});

test("report themed ECharts-only recipes produce previewable options", () => {
  const categoryMetricInput = {
    title: "Operating detail",
    fields: {
      category: {
        source_field: "region",
        result_field: "category_name",
      },
      metric: {
        source_field: "revenue",
        result_field: "metric_value",
      },
    },
  };
  const recipes = [
    buildEChartsKpiCardRecipe({
      title: "Revenue",
      fields: {
        value: {
          source_field: "revenue",
          result_field: "metric_value",
        },
      },
    }),
    buildEChartsSignalListRecipe(categoryMetricInput),
    buildEChartsFunnelRecipe(categoryMetricInput),
    buildEChartsRankedBarRecipe(categoryMetricInput),
  ];

  for (const recipe of recipes) {
    const preview = getTemplatePreviewOption({
      optionTemplate: recipe.renderer.option_template,
      slots: recipe.renderer.slots,
      transforms: recipe.renderer.transforms,
    });

    assert.equal(recipe.renderer.kind, "echarts");
    assert.ok(preview.rowsCount > 0);
    assert.ok(Object.keys(preview.option).length > 0);
  }
});

test("stage chart skill registry exposes report recipe ids", () => {
  const skillIds = listInternalStageChartSkillIds();
  const template = resolveDashboardTemplate();

  assert.deepEqual(skillIds, template.chartRecipeIds);
  assert.ok(skillIds.includes("echarts-kpi-card"));
  assert.ok(skillIds.includes("echarts-signal-list"));
  assert.ok(skillIds.includes("echarts-funnel"));
  assert.ok(skillIds.includes("echarts-ranked-bar"));
});

test("KPI card value slot materializes without taking over shell chrome", () => {
  const recipe = buildEChartsKpiCardRecipe({
    title: "Revenue",
    description: "Total revenue",
    fields: {
      value: {
        source_field: "revenue",
        result_field: "metric_value",
      },
    },
  });
  const preview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
    presentation: {
      chartLabels: {
        "kpiCard.badgeLive": "实时",
      },
    },
  });

  const graphic = (preview.option as { graphic?: Array<{ style?: { text?: string } }> }).graphic;
  const graphicText = JSON.stringify(graphic);

  assert.equal(graphic?.[1]?.style?.text, "156");
  assert.doesNotMatch(graphicText, /Revenue|Total revenue|实时|kpiCard\.badgeLive/);
});

test("dashboard validation rejects unsupported time range defaults", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.filters = [{
    id: "f_time_range",
    kind: "time_range",
    label: "Time",
    scope: "workspace_shared",
    default_value: "last_quarter",
    resolved_fields: ["start", "end", "timezone"],
  }];

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /time_range default_value must be today, this_week or last_12_weeks/,
  );
});

test("dashboard validation defaults missing filter scope to workspace_shared", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.filters = [{
    id: "f_legacy",
    kind: "single_select",
    label: "Legacy",
    options: [{ label: "All", value: "all" }],
    default_value: "all",
  }] as never;

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, true, validation.ok ? undefined : JSON.stringify(validation.issues));
  assert.equal(validation.value.dashboard_spec.filters[0]?.scope, "workspace_shared");
});

test("dashboard filters support template_shared and view_local scopes", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.views = [makeSimpleView("v_revenue"), makeSimpleView("v_orders")];
  document.dashboard_spec.layout.desktop = {
    cols: 12,
    row_height: 30,
    items: [
      { view_id: "v_revenue", x: 0, y: 0, w: 6, h: 7 },
      { view_id: "v_orders", x: 6, y: 0, w: 6, h: 7 },
    ],
  };
  document.dashboard_spec.filters = [
    {
      id: "f_channel",
      kind: "single_select",
      label: "Channel",
      scope: "template_shared",
      affected_view_ids: ["v_revenue", "v_orders"],
      options: [{ label: "All channels", value: "all" }],
      default_value: "all",
    },
    {
      id: "f_region_local",
      kind: "single_select",
      label: "Region",
      scope: "view_local",
      owner_view_id: "v_orders",
      options: [{ label: "North", value: "north" }],
      default_value: "north",
    },
  ];

  const validation = validateDashboardDocument(document, "save");
  assert.equal(validation.ok, true, validation.ok ? undefined : JSON.stringify(validation.issues));
});

test("dashboard validation rejects unsupported filter scopes", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.filters = [{
    id: "f_bad_scope",
    kind: "single_select",
    label: "Bad scope",
    scope: "dashboard_shared",
    options: [{ label: "All", value: "all" }],
    default_value: "all",
  }] as never;

  const validation = validateDashboardDocument(document, "save");
  assert.equal(validation.ok, false);
  assert.match(JSON.stringify(validation.issues), /scope/);
});

test("template_shared filters must define affected_view_ids", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.filters = [{
    id: "f_missing_affected_views",
    kind: "single_select",
    label: "Missing affected views",
    scope: "template_shared",
    options: [{ label: "All", value: "all" }],
    default_value: "all",
  }] as never;

  const validation = validateDashboardDocument(document, "save");
  assert.equal(validation.ok, false);
  assert.match(JSON.stringify(validation.issues), /affected_view_ids/);
});

test("template_shared filters must define non-empty affected_view_ids", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.filters = [{
    id: "f_empty_affected_views",
    kind: "single_select",
    label: "Empty affected views",
    scope: "template_shared",
    affected_view_ids: [],
    options: [{ label: "All", value: "all" }],
    default_value: "all",
  }] as never;

  const validation = validateDashboardDocument(document, "save");
  assert.equal(validation.ok, false);
  assert.match(JSON.stringify(validation.issues), /affected_view_ids/);
});

test("template_shared filters must reference known affected_view_ids", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.views = [makeSimpleView("v_orders")];
  document.dashboard_spec.layout.desktop = {
    cols: 12,
    row_height: 30,
    items: [{ view_id: "v_orders", x: 0, y: 0, w: 6, h: 7 }],
  };
  document.dashboard_spec.filters = [{
    id: "f_unknown_affected_view",
    kind: "single_select",
    label: "Unknown affected view",
    scope: "template_shared",
    affected_view_ids: ["v_missing"],
    options: [{ label: "All", value: "all" }],
    default_value: "all",
  }];

  const validation = validateDashboardDocument(document, "save");
  assert.equal(validation.ok, false);
  assert.match(JSON.stringify(validation.issues), /affected_view_ids/);
});

test("view_local filters must define owner_view_id", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.filters = [{
    id: "f_bad",
    kind: "single_select",
    label: "Broken",
    scope: "view_local",
    options: [{ label: "All", value: "all" }],
  }] as never;

  const validation = validateDashboardDocument(document, "save");
  assert.equal(validation.ok, false);
  assert.match(JSON.stringify(validation.issues), /owner_view_id/);
});

test("view_local filters must reference a known owner_view_id", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.views = [makeSimpleView("v_orders")];
  document.dashboard_spec.layout.desktop = {
    cols: 12,
    row_height: 30,
    items: [{ view_id: "v_orders", x: 0, y: 0, w: 6, h: 7 }],
  };
  document.dashboard_spec.filters = [{
    id: "f_unknown_owner",
    kind: "single_select",
    label: "Unknown owner",
    scope: "view_local",
    owner_view_id: "v_missing",
    options: [{ label: "All", value: "all" }],
    default_value: "all",
  }];

  const validation = validateDashboardDocument(document, "save");
  assert.equal(validation.ok, false);
  assert.match(JSON.stringify(validation.issues), /owner_view_id/);
});

test("dashboard validation rejects unknown filter param mapping paths", () => {
  const document: DashboardDocument = {
    schema_version: "1.0",
    dashboard_spec: {
      schema_version: "0.3",
      presentation: {
        design_kit_id: "operational_report",
        color_theme_id: "purple",
        default_view_style_id: "emphasis",
      },
      dashboard: { name: "Mapped" },
      filters: [
        {
          id: "f_time_range",
          kind: "time_range",
          label: "Time",
          scope: "workspace_shared",
          default_value: "today",
          resolved_fields: ["start", "end", "timezone"],
        },
      ],
      views: [makeSimpleView("v_mapped")],
      layout: {
        desktop: {
          cols: 12,
          row_height: 30,
          items: [{ view_id: "v_mapped", x: 0, y: 0, w: 6, h: 7 }],
        },
      },
    },
    query_defs: [
      {
        id: "q_mapped",
        name: "Mapped query",
        datasource_id: "testing-db",
        sql_template: "select {{start_date}} as value",
        params: [{ name: "start_date", type: "date", required: true }],
        output: { kind: "array", item_type: "number" },
      },
    ],
    bindings: [
      {
        id: "b_mapped",
        view_id: "v_mapped",
        slot_id: "value",
        mode: "live",
        query_id: "q_mapped",
        param_mapping: {
          start_date: { source: "filter", value: "f_missing.start" },
        },
        result_selector: null,
      },
    ],
  };

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /filter mapping must reference a declared dashboard filter/,
  );
});

test("valid dashboard documents receive default template metadata without changing presentation", () => {
  const document: DashboardDocument = {
    schema_version: "1.0",
    dashboard_spec: {
      schema_version: "0.3",
      presentation: {
        design_kit_id: "operational_report",
        color_theme_id: "teal",
        default_view_style_id: "clean",
      },
      dashboard: {
        name: "Untemplated",
      },
      layout: {
        desktop: {
          cols: 12,
          row_height: 30,
          items: [],
        },
      },
      views: [],
      filters: [],
    },
    query_defs: [],
    bindings: [],
  };

  const normalized = ensureLayoutMap(document);

  assert.equal(normalized.dashboard_spec.template?.id, DEFAULT_DASHBOARD_TEMPLATE_ID);
  assert.equal(normalized.dashboard_spec.template?.version, DEFAULT_DASHBOARD_TEMPLATE_VERSION);
  assert.deepEqual(normalized.dashboard_spec.presentation, {
    design_kit_id: "operational_report",
    color_theme_id: "teal",
    default_view_style_id: "clean",
  });
  assert.equal(normalized.dashboard_spec.layout.mobile?.cols, 4);
  assert.equal(normalized.dashboard_spec.views.length, 0);
  assert.equal(normalized.dashboard_spec.layout.desktop?.items.length, 0);
  assert.equal(normalized.dashboard_spec.filters.length, 0);
});

test("dashboard validation rejects unknown template refs", () => {
  const document: DashboardDocument = {
    schema_version: "1.0",
    dashboard_spec: {
      schema_version: "0.3",
      presentation: {
        design_kit_id: "operational_report",
        color_theme_id: "purple",
        default_view_style_id: "emphasis",
      },
      template: {
        id: "unknown-template",
        version: "999",
      },
      dashboard: {
        name: "Unknown template",
      },
      layout: {
        desktop: {
          cols: 12,
          row_height: 30,
          items: [],
        },
      },
      views: [],
      filters: [],
    },
    query_defs: [],
    bindings: [],
  };

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /template must reference a registered dashboard template/,
  );
});

test("known dashboard templates normalize presentation through the design kit registry", () => {
  const document = createDashboardFromTemplate();
  const normalized = applyDashboardTemplateDefaults({
    ...document,
    dashboard_spec: {
      ...document.dashboard_spec,
      presentation: {
        design_kit_id: "operational_report",
        color_theme_id: "teal",
        default_view_style_id: "clean",
      },
    },
  });

  assert.deepEqual(normalized.dashboard_spec.presentation, {
    design_kit_id: "operational_report",
    color_theme_id: "teal",
    default_view_style_id: "clean",
  });
});

test("dashboard validation rejects removed template aliases", () => {
  const document = createDashboardFromTemplate();
  const invalidDocument = {
    ...document,
    dashboard_spec: {
      ...document.dashboard_spec,
      template: {
        id: "delivery-return-report",
        version: "1",
      },
    },
  };
  const validation = validateDashboardDocument(invalidDocument, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /template must reference a registered dashboard template/,
  );
});

test("dashboard validation rejects missing presentation", () => {
  const document = createDashboardFromTemplate();
  const invalidDocument = {
    ...document,
    dashboard_spec: {
      ...document.dashboard_spec,
      presentation: undefined,
    },
  } as unknown as DashboardDocument;
  const validation = validateDashboardDocument(invalidDocument, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /presentation is required/,
  );
});

test("dashboard validation rejects unsupported presentation ids", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.presentation = {
    design_kit_id: "custom",
    color_theme_id: "custom",
    default_view_style_id: "custom",
  };

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /registered dashboard design kit/,
  );
});

test("dashboard documents keep generated mobile layout from desktop items", () => {
  const document: DashboardDocument = {
    schema_version: "1.0",
    dashboard_spec: {
      schema_version: "0.3",
      presentation: {
        design_kit_id: "operational_report",
        color_theme_id: "purple",
        default_view_style_id: "emphasis",
      },
      dashboard: {
        name: "Desktop layout",
      },
      layout: {
        desktop: {
          cols: 12,
          row_height: 30,
          items: [{ view_id: "dashboard_view", x: 0, y: 0, w: 6, h: 7 }],
        },
      },
      views: [makeSimpleView("dashboard_view")],
      filters: [],
    },
    query_defs: [],
    bindings: [],
  };

  const normalized = ensureLayoutMap(document);

  assert.deepEqual(
    normalized.dashboard_spec.layout.mobile?.items.map((item) => item.view_id),
    ["dashboard_view"],
  );
  assert.equal(normalized.dashboard_spec.layout.mobile?.items[0]?.w, 4);
});
