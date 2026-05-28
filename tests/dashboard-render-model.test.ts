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
const { buildDashboardPreviewRequest } = await import(
  "../src/web/dashboard/render-input.ts"
);
const { groupFiltersForViewer } = await import(
  "../src/web/viewer/template-runtime/filter-placement.ts"
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
      template: { id: "report_runtime_v1", version: "1" },
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

test("canonical template still renders shell chrome at zero views", () => {
  const document = makeDocument();
  document.dashboard_spec.views = [];
  document.dashboard_spec.layout.desktop!.items = [];

  const model = buildDashboardRenderModel({
    dashboard: document,
    mode: "preview",
    viewMode: "desktop",
    bindingResults: {},
    requestState: "ready",
  });

  assert.equal(model.visibleViews.length, 0);
  assert.equal(model.template.resolvedId, "report_runtime_v1");
});

test("viewer filter grouping separates template_shared and view_local filters", () => {
  const dashboard = makeDocument();
  dashboard.dashboard_spec.filters = [
    {
      id: "f_shared",
      kind: "single_select",
      label: "Channel",
      scope: "template_shared",
      affected_view_ids: ["v_orders"],
      options: [{ label: "All", value: "all" }],
      default_value: "all",
    },
    {
      id: "f_local",
      kind: "single_select",
      label: "Region",
      scope: "view_local",
      owner_view_id: "v_orders",
      options: [{ label: "North", value: "north" }],
      default_value: "north",
    },
  ] as never;

  const groups = groupFiltersForViewer(dashboard);
  assert.deepEqual(groups.templateShared.map((filter) => filter.id), ["f_shared"]);
  assert.deepEqual(
    groups.viewLocalByViewId.get("v_orders")?.map((filter) => filter.id),
    ["f_local"],
  );
});

test("preview request includes selected values for template_shared and view_local filters", () => {
  const dashboard = makeDocument();
  dashboard.dashboard_spec.filters = [
    {
      id: "f_shared",
      kind: "single_select",
      label: "Channel",
      scope: "template_shared",
      affected_view_ids: ["v_orders"],
      options: [{ label: "All", value: "all" }],
      default_value: "all",
    },
    {
      id: "f_local",
      kind: "single_select",
      label: "Region",
      scope: "view_local",
      owner_view_id: "v_orders",
      options: [{ label: "North", value: "north" }],
      default_value: "north",
    },
  ] as never;

  const request = buildDashboardPreviewRequest({
    dashboard,
    visibleViewIds: ["v_orders"],
    selectedFilterValues: { f_shared: "all", f_local: "north" },
  });

  assert.deepEqual(request.filter_values, { f_shared: "all", f_local: "north" });
});

test("preview request omits workspace_shared filters from single-dashboard payloads", () => {
  const dashboard = makeDocument();
  dashboard.dashboard_spec.filters = [
    {
      id: "f_workspace",
      kind: "single_select",
      label: "Workspace",
      scope: "workspace_shared",
      options: [{ label: "All workspaces", value: "all" }],
      default_value: "all",
    },
    {
      id: "f_shared",
      kind: "single_select",
      label: "Channel",
      scope: "template_shared",
      affected_view_ids: ["v_orders"],
      options: [{ label: "All", value: "all" }],
      default_value: "all",
    },
    {
      id: "f_local",
      kind: "single_select",
      label: "Region",
      scope: "view_local",
      owner_view_id: "v_orders",
      options: [{ label: "North", value: "north" }],
      default_value: "north",
    },
  ] as never;

  const request = buildDashboardPreviewRequest({
    dashboard,
    visibleViewIds: ["v_orders"],
    selectedFilterValues: {
      f_workspace: "all",
      f_shared: "all",
      f_local: "north",
    },
  });

  assert.deepEqual(request.filter_values, { f_shared: "all", f_local: "north" });
});
