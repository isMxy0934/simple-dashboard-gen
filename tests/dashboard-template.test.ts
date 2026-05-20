import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type {
  DashboardDocument,
  DashboardRenderer,
} from "../src/contracts/dashboard.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const {
  DEFAULT_DASHBOARD_TEMPLATE_ID,
  DEFAULT_DASHBOARD_TEMPLATE_VERSION,
  applyDashboardTemplateDefaults,
  createDashboardFromTemplate,
  listDashboardTemplateSummaries,
  resolveDashboardTemplate,
} = await import("../src/domain/dashboard/templates.ts");
const {
  dashboardThemeRef,
  dashboardThemeCssVariables,
  getDefaultDashboardThemeId,
  listDashboardThemes,
  resolveDashboardTheme,
} = await import("../src/presentation/dashboard/themes.ts");
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
const { getTemplatePreviewOption } = await import(
  "../src/renderers/echarts/preview/sample-option.ts"
);
const { materializeEChartsOptionTemplate } = await import(
  "../src/renderers/echarts/browser/materialize-option.ts"
);
const { validateEChartsOptionOnServer } = await import(
  "../src/renderers/echarts/server/validate-option.ts"
);
const { validateEChartsViewsOnServer } = await import(
  "../src/renderers/echarts/server/validate-option.ts"
);
const { validateEChartsRendererPresentationCompatibility } = await import(
  "../src/renderers/echarts/presentation-compatibility.ts"
);
const {
  analyzeDashboardRendererPresentationCompatibility,
  auditDashboardDocumentRendererPresentation,
  auditDashboardRendererPresentationCompatibility,
  migrateDashboardRendererCompatibility,
  migrateDashboardRendererThemeColorRefs,
} = await import("../src/presentation/dashboard/renderer-compatibility.ts");
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
const { getStageChartBuilder, listStageChartSkillIds } = await import(
  "../src/ai/authoring/skills/registry.ts"
);

function makeSimpleView(id: string): DashboardDocument["dashboard_spec"]["views"][number] {
  return {
    id,
    title: "Legacy View",
    renderer: {
      kind: "echarts",
      option_template: {
        xAxis: { type: "category", data: [] },
        yAxis: { type: "value" },
        series: [{ type: "bar", data: [] }],
      },
      slots: [
        { id: "category", path: "xAxis.data", value_kind: "array", required: true },
        { id: "value", path: "series[0].data", value_kind: "array", required: true },
      ],
    },
  };
}

test("default dashboard template creates an empty report shell", () => {
  const document = createDashboardFromTemplate();

  assert.equal(document.dashboard_spec.template?.id, DEFAULT_DASHBOARD_TEMPLATE_ID);
  assert.equal(document.dashboard_spec.template?.version, DEFAULT_DASHBOARD_TEMPLATE_VERSION);
  assert.deepEqual(document.dashboard_spec.presentation, {
    theme_id: "report_purple",
    density: "compact",
    card_chrome: "report",
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

test("dashboard themes resolve the polished report default and legacy alias", () => {
  assert.equal(getDefaultDashboardThemeId(), "report_purple");
  assert.equal(resolveDashboardTheme("report_purple").id, "report_purple");
  assert.equal(resolveDashboardTheme("default_report").id, "report_purple");
  assert.deepEqual(
    listDashboardThemes().map((theme) => theme.id),
    ["report_purple", "report_teal"],
  );
  assert.equal(
    dashboardThemeCssVariables("report_teal")["--dashboard-theme-header"],
    resolveDashboardTheme("report_teal").shell.headerBg,
  );
  assert.equal(
    dashboardThemeCssVariables("report_purple")["--dashboard-theme-accent-soft"],
    resolveDashboardTheme("report_purple").chart.currentSoft,
  );
});

test("presentation context uses theme surface for legacy report aliases", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.presentation = {
    theme_id: "default_report",
    density: "compact",
    card_chrome: "standard",
  };

  const context = resolveViewPresentationContext(document);

  assert.equal(context.theme.id, "report_purple");
  assert.equal(context.chartPresentation.themeId, "report_purple");
  assert.equal(context.isReportSurface, true);
  assert.equal(context.chartPresentation.chartLabels?.["kpiCard.badgeLive"], "Live");
  assert.equal(context.chartPresentation.chartLabels?.["series.actual"], "Actual");
});

test("presentation context merges chart labels and falls back unknown themes at runtime", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.presentation = {
    theme_id: "unknown_theme",
    density: "compact",
    card_chrome: "standard",
  };

  const context = resolveViewPresentationContext(document, {
    chartLabels: { "kpiCard.badgeLive": "Live data" },
  });

  assert.equal(context.theme.id, "report_purple");
  assert.equal(context.chartPresentation.themeId, "report_purple");
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

test("all dashboard chart label refs in bar and KPI recipes materialize localized strings", () => {
  const barRecipe = buildEChartsBarRecipe({ themeId: "report_purple" });
  const kpiRecipe = buildEChartsKpiCardRecipe({
    title: "Revenue",
    fields: {
      value: {
        source_field: "revenue",
        result_field: "metric_value",
      },
    },
  });
  const chartLabels = buildDashboardChartLabels(createTranslator("zh", messagesByLocale));
  const barPreview = getTemplatePreviewOption({
    optionTemplate: barRecipe.renderer.option_template,
    slots: barRecipe.renderer.slots,
    presentation: { chartLabels },
  });
  const kpiPreview = getTemplatePreviewOption({
    optionTemplate: kpiRecipe.renderer.option_template,
    slots: kpiRecipe.renderer.slots,
    presentation: { chartLabels },
  });

  assert.equal(
    (barPreview.option as { series?: Array<{ name?: string }> }).series?.[0]?.name,
    "实际值",
  );
  assert.ok(
    JSON.stringify(kpiPreview.option).includes("实时"),
    "expected localized KPI badge text",
  );
});

test("authoring preview chart presentation preserves localized chart labels", () => {
  const document = createDashboardFromTemplate();
  const chartPresentation = resolveAuthoringPreviewChartPresentation({
    document,
    chartLabels: buildDashboardChartLabels(createTranslator("zh", messagesByLocale)),
  });

  assert.equal(chartPresentation.themeId, "report_purple");
  assert.equal(chartPresentation.chartLabels?.["kpiCard.badgeLive"], "实时");
});

test("dashboard validation only accepts registered presentation theme ids", () => {
  const legacyDocument = createDashboardFromTemplate();
  legacyDocument.dashboard_spec.presentation = {
    theme_id: "default_report",
    density: "compact",
    card_chrome: "report",
  };
  assert.equal(validateDashboardDocument(legacyDocument, "save").ok, true);

  const unknownThemeDocument = createDashboardFromTemplate();
  unknownThemeDocument.dashboard_spec.presentation = {
    theme_id: "custom",
    density: "compact",
    card_chrome: "report",
  };

  const validation = validateDashboardDocument(unknownThemeDocument, "save");

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.issues, [
    {
      path: "dashboard_spec.presentation.theme_id",
      message: "theme_id must be a registered dashboard theme",
    },
  ]);
});

test("template summaries expose selectable report templates", () => {
  const summaries = listDashboardTemplateSummaries();

  assert.deepEqual(
    summaries.map((template) => template.id),
    ["default_report"],
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

test("dashboard template chart recipes resolve to registered stageChart builders", () => {
  const missingRecipeIds = listDashboardTemplateSummaries().flatMap((summary) => {
    const template = resolveDashboardTemplate(summary.ref);
    return template.chartRecipeIds.filter((recipeId) => !getStageChartBuilder(recipeId));
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
  const recipe = buildEChartsBarRecipe({ themeId: "report_purple" });
  const purplePreview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
    presentation: { themeId: "report_purple" },
  });
  const tealPreview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
    presentation: { themeId: "report_teal" },
  });
  const purpleOption = purplePreview.option as {
    color: string[];
    series: Array<{ itemStyle: { color: string } }>;
  };
  const tealOption = tealPreview.option as {
    color: string[];
    series: Array<{ itemStyle: { color: string } }>;
  };

  assert.equal(purpleOption.color[0], resolveDashboardTheme("report_purple").chart.primary);
  assert.equal(tealOption.color[0], resolveDashboardTheme("report_teal").chart.primary);
  assert.equal(tealOption.series[0]?.itemStyle.color, resolveDashboardTheme("report_teal").chart.primary);
  assert.notEqual(purpleOption.color[0], tealOption.color[0]);
});

test("materialized report ECharts option validates on the server with selected theme", async () => {
  const recipe = buildEChartsBarRecipe({ themeId: "report_purple" });
  const preview = getTemplatePreviewOption({
    optionTemplate: recipe.renderer.option_template,
    slots: recipe.renderer.slots,
    transforms: recipe.renderer.transforms,
    presentation: { themeId: "report_teal" },
  });
  const validation = await validateEChartsOptionOnServer(preview.option);

  assert.equal(validation.status, "ok", validation.message);
  assert.doesNotMatch(JSON.stringify(preview.option), /\$theme|\$i18n/);
});

test("bar recipe chart series labels materialize from locale overrides", () => {
  const recipe = buildEChartsBarRecipe({ themeId: "report_purple" });
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

test("renderer compatibility flags legacy KPI slot paths and hardcoded colors", () => {
  const recipe = buildEChartsKpiCardRecipe({
    title: "Revenue",
    fields: {
      value: {
        source_field: "revenue",
        result_field: "metric_value",
      },
    },
  });
  const tokenized = analyzeDashboardRendererPresentationCompatibility(recipe.renderer);

  assert.equal(tokenized.hasThemeRefs, true);
  assert.equal(tokenized.hasI18nRefs, true);
  assert.deepEqual(tokenized.hardcodedColorPaths, []);
  assert.deepEqual(tokenized.migrations, []);

  const legacyRenderer = {
    kind: "echarts",
    option_template: {
      color: "#123456",
      graphic: [
        { type: "text", style: { text: "0" } },
        { type: "text", style: { text: "0", fill: dashboardThemeRef("chart.text") } },
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
  const legacy = analyzeDashboardRendererPresentationCompatibility(legacyRenderer);
  const migrated = migrateDashboardRendererCompatibility(legacyRenderer);
  const audit = auditDashboardRendererPresentationCompatibility(legacyRenderer);

  assert.equal(legacy.hasThemeRefs, true);
  assert.deepEqual(legacy.hardcodedColorPaths, ["color"]);
  assert.equal(audit.hardcodedColors[0]?.status, "unknown");
  assert.equal(legacy.migrations[0]?.toPath, "graphic[1].style.text");
  assert.equal(migrated.renderer.slots[0]?.path, "graphic[1].style.text");
  assert.equal(
    validateEChartsRendererPresentationCompatibility(legacyRenderer).status,
    "warning",
  );
});

test("renderer color audit exposes safe theme migrations without rewriting unknown colors", () => {
  const renderer = {
    kind: "echarts",
    option_template: {
      color: [
        "#3176d3",
        "#fff",
        "rgba(1, 2, 3, 0.4)",
        dashboardThemeRef("chart.current"),
      ],
      dataset: { source: [["#3176d3", 42]] },
      xAxis: { data: ["#3176d3"] },
      series: [
        {
          type: "bar",
          name: "#3176d3",
          data: ["#3176d3"],
          itemStyle: { color: "#5b2e91" },
        },
      ],
      graphic: [
        {
          type: "text",
          style: {
            text: "#3176d3",
            fill: "#3176d3",
          },
        },
      ],
    },
    slots: [],
  } satisfies DashboardRenderer;
  const audit = auditDashboardRendererPresentationCompatibility(renderer);
  const document = createDashboardFromTemplate();
  document.dashboard_spec.views = [{ id: "v_audit", title: "Audit", renderer }];
  const documentAudit = auditDashboardDocumentRendererPresentation(document);
  const migrated = migrateDashboardRendererThemeColorRefs(renderer);
  const migratedOption = migrated.renderer.option_template as {
    color: unknown[];
    dataset: { source: unknown[][] };
    xAxis: { data: unknown[] };
    series: Array<{ itemStyle?: { color?: unknown } }>;
    graphic: Array<{ style?: { text?: unknown; fill?: unknown } }>;
  };

  assert.deepEqual(
    audit.hardcodedColors.map((entry) => [entry.path, entry.status, entry.tokenPath]),
    [
      ["color[0]", "migratable", "chart.primary"],
      ["color[1]", "unknown", undefined],
      ["color[2]", "unknown", undefined],
      ["dataset.source[0][0]", "migratable", "chart.primary"],
      ["xAxis.data[0]", "migratable", "chart.primary"],
      ["series[0].name", "migratable", "chart.primary"],
      ["series[0].data[0]", "migratable", "chart.primary"],
      ["series[0].itemStyle.color", "migratable", "chart.current"],
      ["graphic[0].style.text", "migratable", "chart.primary"],
      ["graphic[0].style.fill", "migratable", "chart.primary"],
    ],
  );
  assert.equal(documentAudit[0]?.viewId, "v_audit");
  assert.equal(documentAudit[0]?.renderer.themeColorMigrations.length, 3);
  assert.equal(migrated.migrations.length, 3);
  assert.equal((migratedOption.color[0] as { $theme?: string }).$theme, "chart.primary");
  assert.equal(migratedOption.color[1], "#fff");
  assert.equal(migratedOption.color[2], "rgba(1, 2, 3, 0.4)");
  assert.equal(migratedOption.dataset.source[0]?.[0], "#3176d3");
  assert.equal(migratedOption.xAxis.data[0], "#3176d3");
  assert.equal((migratedOption.series[0] as { name?: unknown }).name, "#3176d3");
  assert.deepEqual((migratedOption.series[0] as { data?: unknown[] }).data, ["#3176d3"]);
  assert.equal(
    (migratedOption.series[0]?.itemStyle?.color as { $theme?: string }).$theme,
    "chart.current",
  );
  assert.equal(migratedOption.graphic[0]?.style?.text, "#3176d3");
  assert.equal(
    (migratedOption.graphic[0]?.style?.fill as { $theme?: string }).$theme,
    "chart.primary",
  );
});

test("materialization applies non-destructive legacy KPI slot compatibility", () => {
  const legacyRenderer = {
    kind: "echarts",
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

  const option = materializeEChartsOptionTemplate({
    template: legacyRenderer.option_template,
    slots: legacyRenderer.slots,
    bindingResults: [
      {
        slot_id: "value",
        result: {
          view_id: "v_legacy",
          slot_id: "value",
          query_id: "q_legacy",
          status: "ok",
          data: { value: 42 },
        },
      },
    ],
  }) as { graphic: Array<{ style: { text: unknown } }> };

  assert.equal(option.graphic[0]?.style.text, "Revenue");
  assert.equal(option.graphic[1]?.style.text, 42);
});

test("server renderer checks include presentation compatibility warnings", async () => {
  const document = createDashboardFromTemplate();
  const legacyRenderer = {
    kind: "echarts",
    option_template: {
      color: "#123456",
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
  document.dashboard_spec.views = [{
    id: "v_legacy",
    title: "Legacy KPI",
    renderer: legacyRenderer,
  }];

  const checks = await validateEChartsViewsOnServer({
    document,
    visibleViewIds: ["v_legacy"],
    bindingResults: {
      b_legacy: {
        view_id: "v_legacy",
        slot_id: "value",
        query_id: "q_legacy",
        status: "ok",
        data: { value: 42 },
      },
    },
  });

  assert.equal(checks.v_legacy?.server?.status, "ok");
  assert.equal(checks.v_legacy?.presentation?.status, "warning");
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
  const skillIds = listStageChartSkillIds();
  const template = resolveDashboardTemplate();

  assert.deepEqual(skillIds, template.chartRecipeIds);
  assert.ok(skillIds.includes("echarts-kpi-card"));
  assert.ok(skillIds.includes("echarts-signal-list"));
  assert.ok(skillIds.includes("echarts-funnel"));
  assert.ok(skillIds.includes("echarts-ranked-bar"));
});

test("legacy echarts-data-table skill id resolves to ranked bar builder", () => {
  assert.notEqual(
    getStageChartBuilder("echarts-data-table"),
    null,
  );
  assert.equal(
    getStageChartBuilder("echarts-data-table")?.skillId,
    "echarts-ranked-bar",
  );
});

test("legacy echarts-data-table recipe id resolves to ranked bar builder", () => {
  assert.notEqual(getEChartsStageChartRecipeBuilder("echarts-data-table"), null);
  assert.equal(
    getEChartsStageChartRecipeBuilder("echarts-data-table"),
    getEChartsStageChartRecipeBuilder("echarts-ranked-bar"),
  );
});

test("materialization migrates exact theme color matches before resolving themeId", () => {
  const renderer = {
    kind: "echarts",
    option_template: {
      color: ["#3176d3"],
      series: [{ type: "bar", data: [] }],
    },
    slots: [],
  } satisfies DashboardRenderer;

  const option = materializeEChartsOptionTemplate({
    template: renderer.option_template,
    slots: renderer.slots,
    presentation: { themeId: "report_teal" },
    bindingResults: [],
  }) as { color: string[] };

  assert.equal(option.color[0], resolveDashboardTheme("report_teal").chart.primary);
});

test("KPI card chart labels materialize from locale overrides", () => {
  const recipe = buildEChartsKpiCardRecipe({
    title: "Revenue",
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
  assert.match(JSON.stringify(recipe.renderer.option_template), /"\$i18n":"kpiCard\.badgeLive"/);

  const graphic = (preview.option as { graphic?: Array<{ style?: { text?: string } }> }).graphic;
  const badge = graphic?.find((entry) => entry.style?.text === "实时");

  assert.ok(badge);
});

test("dashboard validation rejects unsupported time range defaults", () => {
  const document = createDashboardFromTemplate();
  document.dashboard_spec.filters = [{
    id: "f_time_range",
    kind: "time_range",
    label: "Time",
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

test("dashboard validation rejects unknown filter param mapping paths", () => {
  const document: DashboardDocument = {
    dashboard_spec: {
      schema_version: "0.2",
      dashboard: { name: "Mapped" },
      filters: [
        {
          id: "f_time_range",
          kind: "time_range",
          label: "Time",
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

test("legacy dashboard documents receive default template metadata", () => {
  const legacyDocument: DashboardDocument = {
    dashboard_spec: {
      schema_version: "0.2",
      dashboard: {
        name: "Legacy",
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

  const normalized = ensureLayoutMap(legacyDocument);

  assert.equal(normalized.dashboard_spec.template?.id, DEFAULT_DASHBOARD_TEMPLATE_ID);
  assert.equal(normalized.dashboard_spec.template?.version, DEFAULT_DASHBOARD_TEMPLATE_VERSION);
  assert.equal(normalized.dashboard_spec.presentation?.theme_id, "report_purple");
  assert.equal(normalized.dashboard_spec.presentation?.card_chrome, "report");
  assert.equal(normalized.dashboard_spec.layout.mobile?.cols, 4);
  assert.equal(normalized.dashboard_spec.views.length, 0);
  assert.equal(normalized.dashboard_spec.layout.desktop?.items.length, 0);
  assert.equal(normalized.dashboard_spec.filters.length, 0);
});

test("unknown dashboard template refs preserve the original ref while using fallback presentation", () => {
  const document: DashboardDocument = {
    dashboard_spec: {
      schema_version: "0.2",
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

  const normalized = applyDashboardTemplateDefaults(document);

  assert.equal(normalized.dashboard_spec.template?.id, "unknown-template");
  assert.equal(normalized.dashboard_spec.template?.version, "999");
  assert.equal(normalized.dashboard_spec.presentation?.theme_id, "report_purple");
});

test("known dashboard templates preserve explicit presentation overrides", () => {
  const document = createDashboardFromTemplate();
  const normalized = applyDashboardTemplateDefaults({
    ...document,
    dashboard_spec: {
      ...document.dashboard_spec,
      presentation: {
        theme_id: "custom",
        density: "comfortable",
        card_chrome: "standard",
      },
    },
  });

  assert.deepEqual(normalized.dashboard_spec.presentation, {
    theme_id: "custom",
    density: "comfortable",
    card_chrome: "standard",
  });
});

test("delivery return template id is treated as an unknown template", () => {
  const document = createDashboardFromTemplate();
  const normalized = applyDashboardTemplateDefaults({
    ...document,
    dashboard_spec: {
      ...document.dashboard_spec,
      template: {
        id: "delivery-return-report",
        version: "1",
      },
      presentation: undefined,
    },
  });

  assert.equal(normalized.dashboard_spec.template?.id, "delivery-return-report");
  assert.equal(normalized.dashboard_spec.presentation?.theme_id, "report_purple");
  assert.deepEqual(normalized.dashboard_spec.views, []);
});

test("missing dashboard template preserves explicit presentation overrides", () => {
  const document = createDashboardFromTemplate();
  const normalized = applyDashboardTemplateDefaults({
    ...document,
    dashboard_spec: {
      ...document.dashboard_spec,
      template: undefined,
      presentation: {
        theme_id: "custom",
        density: "comfortable",
        card_chrome: "standard",
      },
    },
  });

  assert.deepEqual(normalized.dashboard_spec.presentation, {
    theme_id: "custom",
    density: "comfortable",
    card_chrome: "standard",
  });
});

test("legacy dashboard documents keep generated mobile layout from desktop items", () => {
  const legacyDocument: DashboardDocument = {
    dashboard_spec: {
      schema_version: "0.2",
      dashboard: {
        name: "Legacy with desktop layout",
      },
      layout: {
        desktop: {
          cols: 12,
          row_height: 30,
          items: [{ view_id: "legacy_view", x: 0, y: 0, w: 6, h: 7 }],
        },
      },
      views: [makeSimpleView("legacy_view")],
      filters: [],
    },
    query_defs: [],
    bindings: [],
  };

  const normalized = ensureLayoutMap(legacyDocument);

  assert.deepEqual(
    normalized.dashboard_spec.layout.mobile?.items.map((item) => item.view_id),
    ["legacy_view"],
  );
  assert.equal(normalized.dashboard_spec.layout.mobile?.items[0]?.w, 4);
});
