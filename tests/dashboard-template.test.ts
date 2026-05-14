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
} = await import("../src/domain/dashboard/templates.ts");
const { ensureLayoutMap } = await import("../src/domain/dashboard/document.ts");
const { validateDashboardDocument } = await import("../src/contracts/validation.ts");
const { getTemplatePreviewOption } = await import(
  "../src/renderers/echarts/preview/sample-option.ts"
);
const { buildEChartsLineRecipe } = await import(
  "../src/renderers/echarts/recipes/stage-chart-recipes.ts"
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

test("default dashboard template creates a delivery return report document", () => {
  const document = createDashboardFromTemplate();

  assert.equal(document.dashboard_spec.template?.id, DEFAULT_DASHBOARD_TEMPLATE_ID);
  assert.equal(document.dashboard_spec.template?.version, DEFAULT_DASHBOARD_TEMPLATE_VERSION);
  assert.deepEqual(document.dashboard_spec.presentation, {
    theme_id: "delivery-return-report",
    density: "compact",
    card_chrome: "report",
  });
  assert.equal(document.dashboard_spec.layout.desktop?.cols, 12);
  assert.equal(document.dashboard_spec.layout.mobile?.cols, 4);
  assert.deepEqual(
    document.dashboard_spec.views.map((view) => view.title),
    [
      "Individual Return / Total Return",
      "Damaged vs Individual",
      "Individual Return Drivers / Total Return Drivers",
    ],
  );
  assert.deepEqual(document.dashboard_spec.layout.desktop?.items, [
    { view_id: "delivery_return_individual_total", x: 0, y: 0, w: 6, h: 12 },
    { view_id: "delivery_return_damaged_individual", x: 6, y: 0, w: 6, h: 12 },
    { view_id: "delivery_return_drivers", x: 0, y: 12, w: 12, h: 12 },
  ]);
  assert.ok(document.dashboard_spec.filters.length >= 2);

  const validation = validateDashboardDocument(document, "save");
  assert.equal(
    validation.ok,
    true,
    validation.ok ? undefined : JSON.stringify(validation.issues),
  );
});

test("default delivery report preview uses date-like axis samples", () => {
  const document = createDashboardFromTemplate();
  const firstView = document.dashboard_spec.views[0];
  assert.ok(firstView);

  const preview = getTemplatePreviewOption({
    optionTemplate: firstView.renderer.option_template,
    slots: firstView.renderer.slots,
  });
  const option = preview.option as {
    xAxis: { data: unknown[] };
    series: Array<{ data: unknown[] }>;
  };

  assert.deepEqual(option.xAxis.data.slice(0, 3), [
    "2026/3/16",
    "2026/3/23",
    "2026/3/30",
  ]);
  assert.deepEqual(option.series[0]?.data.slice(0, 3), [120, 156, 194]);
  assert.equal(option.series[0]?.data.length, option.xAxis.data.length);
  assert.equal(option.series[1]?.data.length, option.xAxis.data.length);
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
    "Damaged Return",
    "Individual Return",
  ]);
  assert.equal(option.dataset.source.length, 10);
  assert.deepEqual(
    option.series.map((series) => series.name),
    ["Damaged Return", "Individual Return"],
  );
  assert.ok(option.series.every((series) => series.type === "line"));
  assert.equal(preview.rowsCount, 18);
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
  assert.equal(normalized.dashboard_spec.presentation?.theme_id, "delivery-return-report");
  assert.equal(normalized.dashboard_spec.presentation?.card_chrome, "report");
  assert.equal(normalized.dashboard_spec.layout.mobile?.cols, 4);
  assert.equal(normalized.dashboard_spec.views.length, 0);
  assert.equal(normalized.dashboard_spec.layout.desktop?.items.length, 0);
  assert.ok(normalized.dashboard_spec.filters.length >= 2);
});

test("unknown dashboard template refs canonicalize to the resolved default template", () => {
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

  assert.equal(normalized.dashboard_spec.template?.id, DEFAULT_DASHBOARD_TEMPLATE_ID);
  assert.equal(normalized.dashboard_spec.template?.version, DEFAULT_DASHBOARD_TEMPLATE_VERSION);
  assert.equal(normalized.dashboard_spec.presentation?.theme_id, "delivery-return-report");
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
