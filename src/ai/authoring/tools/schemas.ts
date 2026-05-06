import { z } from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const layoutItemSchema = z.object({
  view_id: z.string().min(1),
  x: z.number().int().min(0).describe("Grid x position, not pixels."),
  y: z.number().int().min(0).describe("Grid y position, not pixels."),
  w: z.number().int().min(1).describe("Grid width in columns, not pixels."),
  h: z.number().int().min(1).describe("Grid height in rows, not pixels."),
});

export const rendererSlotSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  value_kind: z.enum(["rows", "array", "object", "scalar"]),
  required: z.boolean().optional(),
  formatter: z.enum(["integer", "usd_0", "usd_2"]).optional(),
});

export const rendererSchema = z.object({
  kind: z.literal("echarts").describe("Only echarts is valid. Do not use chart labels such as kpi-text as renderer.kind."),
  option_template: z.record(z.string(), z.any()).describe("Required ECharts option object with every slot path pre-existing."),
  slots: z.array(rendererSlotSchema).describe("Renderer slots whose path must reference an existing node in option_template."),
});

const canonicalUpsertViewInputSchema = z.object({
  goal_id: z.string().min(1).optional(),
  request: z.string().min(1),
  view_spec: z.object({
    view_id: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    renderer: rendererSchema,
  }),
  layout: z
    .object({
      desktop: layoutItemSchema.optional(),
      mobile: layoutItemSchema.optional(),
    })
    .optional(),
}).strict();

export const upsertViewInputSchema = z.preprocess((value) => {
  if (!isRecord(value) || !isRecord(value.view_spec)) {
    return value;
  }
  const viewSpec = value.view_spec;
  if (!Array.isArray(viewSpec.slots) || !isRecord(viewSpec.renderer)) {
    return value;
  }
  if (Array.isArray(viewSpec.renderer.slots)) {
    return value;
  }

  const { slots: misplacedSlots, ...restViewSpec } = viewSpec;
  return {
    ...value,
    view_spec: {
      ...restViewSpec,
      renderer: {
        ...viewSpec.renderer,
        slots: misplacedSlots,
      },
    },
  };
}, canonicalUpsertViewInputSchema);

const partialLayoutItemSchema = z.object({
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional(),
  w: z.number().int().min(1).optional(),
  h: z.number().int().min(1).optional(),
}).strict();

export const queryParamSchema = z.object({
  name: z.string().min(1).describe("QueryDef.params[].name. Must match a {{param_name}} used in sql_template."),
  type: z.enum(["string", "number", "boolean", "date", "datetime"]),
  required: z.boolean().optional(),
  default_value: z.any().optional(),
  cardinality: z.enum(["scalar", "array"]).optional(),
}).strict();

const queryParamTypeSchema = z.enum(["string", "number", "boolean", "date", "datetime"]);

export const resultSchemaFieldSchema = z.object({
  name: z.string().min(1).describe("Column alias returned by sql_template."),
  type: queryParamTypeSchema,
  nullable: z.boolean(),
}).strict();

export const queryOutputSchema = z.union([
  z.object({
    kind: z.literal("rows"),
    schema: z.array(resultSchemaFieldSchema).min(1).describe("Returned row schema. Use this for tables, trends, categories, and SQL result sets."),
  }).strict(),
  z.object({
    kind: z.literal("array"),
    item_type: queryParamTypeSchema,
  }).strict(),
  z.object({
    kind: z.literal("object"),
    schema: z.array(resultSchemaFieldSchema).min(1),
  }).strict(),
  z.object({
    kind: z.literal("scalar"),
    value_type: queryParamTypeSchema,
  }).strict(),
]).describe("Canonical QueryDef.output. Valid kinds are rows, array, object, scalar. Never use kind=table or output.fields.");

export const querySchema = z.object({
  id: z.string().min(1).describe("Stable QueryDef id."),
  name: z.string().min(1).describe("Human-readable query name."),
  datasource_id: z.string().min(1),
  sql_template: z.string().min(1).describe("Read-only SELECT or CTE + SELECT SQL template. Use sql_template, never sql."),
  params: z.array(queryParamSchema).describe("QueryDef params. Use params, never parameters."),
  output: queryOutputSchema.describe("Required nested output contract inside query.output."),
}).strict().describe("Canonical QueryDef. Must include output inside query; top-level output is invalid.");

export const stageChartFieldSchema = z.object({
  source_field: z.string().min(1).optional(),
  result_field: z.string().min(1).describe("Column alias or output field name produced by query.output."),
  label: z.string().min(1).optional(),
  type: queryParamTypeSchema.optional(),
  aggregation: z.string().min(1).optional(),
}).strict();

export const stageChartQuerySchema = z.object({
  query_id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  datasource_id: z.string().min(1).optional(),
  sql_template: z.string().min(1).describe("Read-only SELECT or CTE + SELECT SQL template."),
  params: z.array(queryParamSchema).optional(),
  output: queryOutputSchema,
}).strict();

export const stageChartInputSchema = z.object({
  goal_id: z.string().min(1).optional(),
  reason: z.string().optional(),
  skill_id: z.string().min(1).describe("Canonical skill id such as echarts-line, echarts-bar, echarts-kpi-text, or echarts-kpi-gauge."),
  title: z.string().min(1),
  description: z.string().optional(),
  target_view_id: z.string().min(1).optional(),
  datasource_id: z.string().min(1).optional(),
  table: z.string().min(1).optional(),
  data_mode: z.enum(["live", "mock"]).optional(),
  query: stageChartQuerySchema.optional(),
  fields: z.object({
    time: stageChartFieldSchema.optional(),
    category: stageChartFieldSchema.optional(),
    metric: stageChartFieldSchema.optional(),
    value: stageChartFieldSchema.optional(),
  }).strict(),
  layout: z.object({
    desktop: partialLayoutItemSchema.optional(),
    mobile: partialLayoutItemSchema.optional(),
  }).strict().optional(),
  mock_data: z.object({
    rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  }).strict().optional(),
  mock_value: z.any().optional(),
}).strict();

export const upsertQueryInputSchema = z.object({
  goal_id: z.string().min(1).optional(),
  reason: z.string().optional(),
  query: querySchema,
}).strict();

export const bindingParamMappingSchema = z.object({
  source: z.enum(["filter", "constant", "runtime_context"]),
  value: z.any(),
}).strict();

const liveBindingSchema = z.object({
  id: z.string().min(1),
  view_id: z.string().min(1),
  slot_id: z.string().min(1),
  mode: z.literal("live").optional(),
  query_id: z.string().min(1),
  param_mapping: z.record(z.string(), bindingParamMappingSchema).describe("Required for live bindings. Use {} when the query has no params."),
  result_selector: z.string().nullable().optional().describe("Only use for rows output selectors: rows, rows[0], rows[].field, or rows[0].field. Leave null/undefined for scalar, array, or object query outputs."),
}).strict();

const mockBindingSchema = z.object({
  id: z.string().min(1),
  view_id: z.string().min(1),
  slot_id: z.string().min(1),
  mode: z.literal("mock"),
  mock_value: z.any().optional(),
  mock_data: z
    .object({
      rows: z.array(z.record(z.string(), z.any())),
    })
    .optional(),
}).strict();

export const bindingSchema = z.union([
  liveBindingSchema,
  mockBindingSchema,
]).describe("Canonical Binding. Live bindings require query_id and param_mapping. result_selector is only for rows outputs.");

export const upsertBindingInputSchema = z.object({
  goal_id: z.string().min(1).optional(),
  reason: z.string().optional(),
  binding: bindingSchema,
}).strict();

export const upsertLayoutInputSchema = z.object({
  goal_id: z.string().min(1).optional(),
  reason: z.string().optional(),
  view_id: z.string().min(1),
  layout: z.object({
    desktop: layoutItemSchema,
    mobile: layoutItemSchema,
  }).strict(),
}).strict();
