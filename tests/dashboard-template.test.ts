import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type { DashboardDocument } from "../src/contracts/dashboard.ts";

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
  dashboardThemeCssVariables,
  getDefaultDashboardThemeId,
  listDashboardThemes,
  resolveDashboardTheme,
} = await import("../src/domain/dashboard/themes.ts");
const { ensureLayoutMap } = await import("../src/domain/dashboard/document.ts");
const { validateDashboardDocument } = await import("../src/contracts/validation.ts");
const { getTemplatePreviewOption } = await import(
  "../src/renderers/echarts/preview/sample-option.ts"
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
    dashboardThemeCssVariables("report_teal")["--report-theme-header"],
    resolveDashboardTheme("report_teal").shell.headerBg,
  );
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
