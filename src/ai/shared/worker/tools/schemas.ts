import { z } from "zod";

export const layoutItemSchema = z.object({
  view_id: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

export const rendererSlotSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  value_kind: z.enum(["rows", "array", "object", "scalar"]),
  required: z.boolean().optional(),
  formatter: z.enum(["integer", "usd_0", "usd_2"]).optional(),
});

export const rendererSchema = z.object({
  kind: z.literal("echarts"),
  option_template: z.record(z.string(), z.any()),
  slots: z.array(rendererSlotSchema),
});

export const queryParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "date", "datetime"]),
  required: z.boolean().optional(),
  default_value: z.any().optional(),
  cardinality: z.enum(["scalar", "array"]).optional(),
});

export const resultSchemaFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "date", "datetime"]),
  nullable: z.boolean(),
});

export const queryOutputSchema = z.union([
  z.object({
    kind: z.literal("rows"),
    schema: z.array(resultSchemaFieldSchema),
  }),
  z.object({
    kind: z.literal("array"),
  }),
  z.object({
    kind: z.literal("object"),
  }),
  z.object({
    kind: z.literal("scalar"),
    value_type: z.enum(["string", "number", "boolean", "date", "datetime"]),
  }),
]);

export const querySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  datasource_id: z.string().min(1),
  sql_template: z.string().min(1),
  params: z.array(queryParamSchema),
  output: queryOutputSchema,
});

export const bindingParamMappingSchema = z.object({
  source: z.enum(["filter", "constant", "runtime_context"]),
  value: z.any(),
});

export const bindingSchema = z.object({
  id: z.string().min(1),
  view_id: z.string().min(1),
  slot_id: z.string().min(1),
  mode: z.enum(["mock", "live"]).optional(),
  query_id: z.string().min(1).optional(),
  param_mapping: z.record(z.string(), bindingParamMappingSchema).optional(),
  result_selector: z.string().nullable().optional(),
  mock_value: z.any().optional(),
  mock_data: z
    .object({
      rows: z.array(z.record(z.string(), z.any())),
    })
    .optional(),
});
