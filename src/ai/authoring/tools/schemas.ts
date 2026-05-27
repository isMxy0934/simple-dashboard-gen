import { Type } from "typebox";
import type {
  DashboardDesignKitId,
  DashboardViewStyleId,
} from "../../../contracts/dashboard-presentation";
import {
  DASHBOARD_DESIGN_KIT_IDS,
  DASHBOARD_VIEW_STYLE_IDS,
} from "../../../contracts/dashboard-presentation-ids.js";
import {
  DASHBOARD_VIEW_KIND_IDS,
  type DashboardViewKind,
} from "../../../contracts/dashboard-view-intent";

const dashboardDesignKitSchema = Type.Unsafe<DashboardDesignKitId>({
  enum: [...DASHBOARD_DESIGN_KIT_IDS],
});

const dashboardViewStyleSchema = Type.Unsafe<DashboardViewStyleId>({
  enum: [...DASHBOARD_VIEW_STYLE_IDS],
});

export const stageChartFieldSchema = Type.Object(
  {
    source_field: Type.String({ minLength: 1 }),
    label: Type.Optional(Type.String({ minLength: 1 })),
    type: Type.Optional(
      Type.Union([
        Type.Literal("string"),
        Type.Literal("number"),
        Type.Literal("boolean"),
        Type.Literal("date"),
        Type.Literal("datetime"),
      ]),
    ),
    aggregation: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const stageViewIntentFieldSchema = Type.Object(
  {
    source_field: Type.String({ minLength: 1 }),
    label: Type.Optional(Type.String({ minLength: 1 })),
    type: Type.Optional(
      Type.Union([
        Type.Literal("string"),
        Type.Literal("number"),
        Type.Literal("boolean"),
        Type.Literal("date"),
        Type.Literal("datetime"),
      ]),
    ),
    aggregation: Type.Optional(Type.String({ minLength: 1 })),
    time_grain: Type.Optional(
      Type.Union([
        Type.Literal("day"),
        Type.Literal("week"),
        Type.Literal("month"),
      ]),
    ),
  },
  { additionalProperties: false },
);

const dashboardViewKindSchema = Type.Unsafe<DashboardViewKind>({
  enum: [...DASHBOARD_VIEW_KIND_IDS],
});

const stageChartIntentSchemaProperties = {
    goal_id: Type.Optional(Type.String({ minLength: 1 })),
    reason: Type.Optional(Type.String()),
    skill_id: Type.String({ minLength: 1 }),
    design_kit_id: Type.Optional(dashboardDesignKitSchema),
    view_style_id: Type.Optional(dashboardViewStyleSchema),
    title: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    datasource_id: Type.String({ minLength: 1 }),
    table: Type.String({ minLength: 1 }),
    data_mode: Type.Optional(
      Type.Union([Type.Literal("live"), Type.Literal("mock")]),
    ),
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
    time_grain: Type.Optional(
      Type.Union([
        Type.Literal("day"),
        Type.Literal("week"),
        Type.Literal("month"),
      ]),
    ),
    sort: Type.Optional(
      Type.Object(
        {
          field_role: Type.Optional(
            Type.Union([
              Type.Literal("time"),
              Type.Literal("category"),
              Type.Literal("metric"),
              Type.Literal("value"),
              Type.Literal("series"),
            ]),
          ),
          direction: Type.Optional(
            Type.Union([Type.Literal("asc"), Type.Literal("desc")]),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    filters: Type.Optional(
      Type.Array(
        Type.Object(
          {
            field: Type.String({ minLength: 1 }),
            op: Type.Union([
              Type.Literal("eq"),
              Type.Literal("neq"),
              Type.Literal("gt"),
              Type.Literal("gte"),
              Type.Literal("lt"),
              Type.Literal("lte"),
            ]),
            value: Type.Union([
              Type.String(),
              Type.Number(),
              Type.Boolean(),
            ]),
          },
          { additionalProperties: false },
        ),
        { maxItems: 12 },
      ),
    ),
    layout: Type.Optional(
      Type.Object(
        {
          desktop: Type.Optional(
            Type.Object(
              {
                x: Type.Optional(Type.Integer({ minimum: 0 })),
                y: Type.Optional(Type.Integer({ minimum: 0 })),
                w: Type.Optional(Type.Integer({ minimum: 1 })),
                h: Type.Optional(Type.Integer({ minimum: 1 })),
              },
              { additionalProperties: false },
            ),
          ),
          mobile: Type.Optional(
            Type.Object(
              {
                x: Type.Optional(Type.Integer({ minimum: 0 })),
                y: Type.Optional(Type.Integer({ minimum: 0 })),
                w: Type.Optional(Type.Integer({ minimum: 1 })),
                h: Type.Optional(Type.Integer({ minimum: 1 })),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    mock_data: Type.Optional(
      Type.Object(
        {
          rows: Type.Array(
            Type.Record(
              Type.String(),
              Type.Union([
                Type.String(),
                Type.Number(),
                Type.Boolean(),
                Type.Null(),
              ]),
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    mock_value: Type.Optional(Type.Any()),
};

export const stageChartInputSchema = Type.Object(
  {
    ...stageChartIntentSchemaProperties,
    target_view_id: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

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
    data_mode: Type.Optional(
      Type.Union([Type.Literal("live"), Type.Literal("mock")]),
    ),
    fields: Type.Object(
      {
        time: Type.Optional(stageViewIntentFieldSchema),
        category: Type.Optional(stageViewIntentFieldSchema),
        metric: Type.Optional(stageViewIntentFieldSchema),
        value: Type.Optional(stageViewIntentFieldSchema),
        series: Type.Optional(stageViewIntentFieldSchema),
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

export const stageReplaceChartInputSchema = Type.Object(
  {
    ...stageChartIntentSchemaProperties,
    replace_view_id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
