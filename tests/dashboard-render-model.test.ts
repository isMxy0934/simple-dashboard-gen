import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type {
  BindingResults,
  DashboardDocument,
  DashboardView,
} from "../src/contracts/dashboard.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const { buildDashboardRenderModel } = await import(
  "../src/web/dashboard/render/render-model.ts"
);
const { deriveRenderedViews } = await import(
  "../src/web/viewer/state/rendered-views.ts"
);
const { createTemporaryDashboardViewIntentForRecipe } = await import(
  "../src/contracts/dashboard-view-intent.ts"
);

function makeView(id: string): DashboardView {
  return {
    id,
    title: "Orders",
    description: "Orders by week",
    view_intent: createTemporaryDashboardViewIntentForRecipe({
      recipe_id: "echarts-bar",
      datasource_id: "testing-db",
      table: "orders",
      data_mode: "mock",
      fields: {
        category: { source_field: "week" },
        metric: { source_field: "orders", aggregation: "sum" },
      },
    }),
    renderer: {
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
    },
  };
}

function makeDocument(): DashboardDocument {
  return {
    schema_version: "1.0",
    dashboard_spec: {
      schema_version: "0.3",
      template: { id: "operational_report", version: "1" },
      presentation: {
        design_kit_id: "operational_report",
        color_theme_id: "purple",
        default_view_style_id: "emphasis",
      },
      dashboard: {
        name: "Render model",
      },
      layout: {
        desktop: {
          cols: 12,
          row_height: 30,
          items: [{ view_id: "v_orders", x: 0, y: 0, w: 6, h: 6 }],
        },
        mobile: {
          cols: 4,
          row_height: 30,
          items: [{ view_id: "v_orders", x: 0, y: 0, w: 4, h: 6 }],
        },
      },
      views: [makeView("v_orders")],
      filters: [],
    },
    query_defs: [],
    bindings: [],
  };
}

function makeBindingResults(): BindingResults {
  return {
    b_orders_category: {
      view_id: "v_orders",
      slot_id: "category",
      query_id: "q_orders",
      status: "ok",
      data: {
        value: ["A", "B"],
      },
    },
    b_orders_value: {
      view_id: "v_orders",
      slot_id: "value",
      query_id: "q_orders",
      status: "ok",
      data: {
        value: [10, 20],
      },
    },
  };
}

test("preview and published modes build the same dashboard card model", () => {
  const document = makeDocument();
  const bindingResults = makeBindingResults();
  const preview = buildDashboardRenderModel({
    dashboard: document,
    mode: "preview",
    viewMode: "desktop",
    bindingResults,
    requestState: "ready",
  });
  const published = buildDashboardRenderModel({
    dashboard: document,
    mode: "published",
    viewMode: "desktop",
    bindingResults,
    requestState: "ready",
  });

  assert.deepEqual(
    preview.cards.map(({ editingOverlay, ...card }) => card),
    published.cards.map(({ editingOverlay, ...card }) => card),
  );
});

test("editing mode only adds editing overlay metadata", () => {
  const document = makeDocument();
  const bindingResults = makeBindingResults();
  const preview = buildDashboardRenderModel({
    dashboard: document,
    mode: "preview",
    viewMode: "desktop",
    bindingResults,
    requestState: "ready",
  });
  const editing = buildDashboardRenderModel({
    dashboard: document,
    mode: "editing",
    viewMode: "desktop",
    bindingResults,
    requestState: "ready",
  });

  assert.deepEqual(
    editing.cards.map(({ editingOverlay, ...card }) => card),
    preview.cards.map(({ editingOverlay, ...card }) => card),
  );
  assert.deepEqual(editing.cards.map((card) => card.editingOverlay), [true]);
  assert.deepEqual(preview.cards.map((card) => card.editingOverlay), [false]);
});

test("ready render status errors when a required slot has no result", () => {
  const document = makeDocument();
  const bindingResults = makeBindingResults();
  delete bindingResults.b_orders_value;

  const model = buildDashboardRenderModel({
    dashboard: document,
    mode: "preview",
    viewMode: "desktop",
    bindingResults,
    requestState: "ready",
  });

  assert.equal(model.statusMap.v_orders, "error");
  assert.equal(model.cards[0]?.status, "error");
});

test("rendered view data count uses the largest slot cardinality", () => {
  const view = makeView("v_orders");
  const renderedViews = deriveRenderedViews(
    [view],
    makeBindingResults(),
    { v_orders: "ok" },
  );

  assert.equal(renderedViews[0]?.dataCount, 2);
});
