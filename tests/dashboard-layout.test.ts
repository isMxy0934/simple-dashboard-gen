import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type {
  DashboardDocument,
  DashboardLayoutItem,
  DashboardView,
} from "../src/contracts/dashboard.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const { upsertViewInDocument } = await import(
  "../src/domain/dashboard/document.ts"
);
const { buildLayoutItem } = await import(
  "../src/ai/authoring/tools/stage-chart-resolve.ts"
);
const { buildCandidateDocument } = await import(
  "../src/ai/authoring/tools/candidate-document.ts"
);
const { createWorkingDraftState } = await import(
  "../src/ai/authoring/tools/draft-state.ts"
);
const { validateDashboardDocument } = await import(
  "../src/contracts/validation.ts"
);

function makeView(id: string, title = id): DashboardView {
  return {
    id,
    title,
    description: "",
    renderer: {
      kind: "echarts",
      option_template: {
        dataset: {
          source: [],
        },
        series: [
          {
            type: "bar",
          },
        ],
      },
      slots: [
        {
          id: "main",
          path: "dataset.source",
          value_kind: "rows",
          required: true,
        },
      ],
    },
  };
}

function makeDocument(): DashboardDocument {
  return {
    dashboard_spec: {
      schema_version: "0.2",
      dashboard: {
        name: "Layout test",
      },
      layout: {
        desktop: {
          cols: 12,
          row_height: 30,
          items: [
            { view_id: "v1", x: 0, y: 0, w: 6, h: 7 },
            { view_id: "v2", x: 6, y: 0, w: 6, h: 14 },
          ],
        },
        mobile: {
          cols: 4,
          row_height: 30,
          items: [
            { view_id: "v1", x: 0, y: 0, w: 4, h: 6 },
            { view_id: "v2", x: 0, y: 6, w: 4, h: 6 },
          ],
        },
      },
      views: [makeView("v1"), makeView("v2")],
      filters: [],
    },
    query_defs: [],
    bindings: [],
  };
}

function findItem(items: DashboardLayoutItem[], viewId: string): DashboardLayoutItem {
  const item = items.find((candidate) => candidate.view_id === viewId);
  assert.ok(item, `Expected layout item for ${viewId}`);
  return item;
}

test("upsertViewInDocument appends new views below existing layout", () => {
  const next = upsertViewInDocument(makeDocument(), makeView("v3"), {
    mobileLayoutMode: "custom",
    desktopItem: { view_id: "v3", x: 0, y: 0, w: 12, h: 5 },
    mobileItem: { view_id: "v3", x: 0, y: 0, w: 4, h: 5 },
  });

  const desktopItems = next.dashboard_spec.layout.desktop?.items ?? [];
  const mobileItems = next.dashboard_spec.layout.mobile?.items ?? [];

  assert.deepEqual(findItem(desktopItems, "v1"), {
    view_id: "v1",
    x: 0,
    y: 0,
    w: 6,
    h: 7,
  });
  assert.deepEqual(findItem(desktopItems, "v2"), {
    view_id: "v2",
    x: 6,
    y: 0,
    w: 6,
    h: 14,
  });
  assert.deepEqual(findItem(desktopItems, "v3"), {
    view_id: "v3",
    x: 0,
    y: 14,
    w: 12,
    h: 5,
  });
  assert.equal(findItem(mobileItems, "v3").y, 12);
});

test("buildLayoutItem preserves existing view placement when restaging", () => {
  const existingItem = buildLayoutItem({
    document: makeDocument(),
    breakpoint: "desktop",
    viewId: "v1",
    defaults: {
      w: 12,
      h: 5,
    },
  });

  assert.deepEqual(existingItem, {
    view_id: "v1",
    x: 0,
    y: 0,
    w: 6,
    h: 7,
  });
});

test("buildLayoutItem ignores y overrides for brand-new views", () => {
  const appendedItem = buildLayoutItem({
    document: makeDocument(),
    breakpoint: "desktop",
    viewId: "v3",
    defaults: {
      w: 6,
      h: 5,
    },
    override: {
      x: 6,
      y: 0,
      w: 6,
      h: 5,
    },
  });

  assert.deepEqual(appendedItem, {
    view_id: "v3",
    x: 6,
    y: 14,
    w: 6,
    h: 5,
  });
});

test("buildCandidateDocument preserves existing layout and appends legacy staged views", () => {
  const base = makeDocument();
  const staged = makeDocument();
  staged.dashboard_spec.views.push(makeView("v3"));
  staged.dashboard_spec.layout.desktop?.items.push({
    view_id: "v3",
    x: 0,
    y: 0,
    w: 12,
    h: 5,
  });
  staged.dashboard_spec.layout.mobile?.items.push({
    view_id: "v3",
    x: 0,
    y: 0,
    w: 4,
    h: 5,
  });

  const candidate = buildCandidateDocument(base, createWorkingDraftState({
    dashboardSpec: staged.dashboard_spec,
    dirtyViewIds: ["v3"],
    dirtyQueryIds: [],
    dirtyBindingIds: [],
    layoutTouched: true,
    ownership: null,
    stagedAt: null,
  } as never));

  assert.deepEqual(candidate.dashboard_spec.layout.desktop?.items, [
    { view_id: "v1", x: 0, y: 0, w: 6, h: 7 },
    { view_id: "v2", x: 6, y: 0, w: 6, h: 14 },
    { view_id: "v3", x: 0, y: 14, w: 12, h: 5 },
  ]);
  assert.deepEqual(candidate.dashboard_spec.layout.mobile?.items, [
    { view_id: "v1", x: 0, y: 0, w: 4, h: 6 },
    { view_id: "v2", x: 0, y: 6, w: 4, h: 6 },
    { view_id: "v3", x: 0, y: 12, w: 4, h: 5 },
  ]);
});

test("dashboard validation rejects fractional grid coordinates", () => {
  const document = makeDocument();
  document.dashboard_spec.layout.desktop!.items[0] = {
    view_id: "v1",
    x: 0.5,
    y: 0,
    w: 6,
    h: 7,
  };

  const validation = validateDashboardDocument(document, "save");

  assert.equal(validation.ok, false);
  assert.match(
    validation.ok ? "" : validation.issues.map((issue) => issue.message).join("\n"),
    /x must be an integer/,
  );
});
