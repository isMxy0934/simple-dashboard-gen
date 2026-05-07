import { z } from "zod";

const partialLayoutItemSchema = z.object({
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional(),
  w: z.number().int().min(1).optional(),
  h: z.number().int().min(1).optional(),
}).strict();

const queryParamTypeSchema = z.enum(["string", "number", "boolean", "date", "datetime"]);

export const stageChartFieldSchema = z.object({
  source_field: z.string().min(1).describe("Datasource table field name or qualified field name."),
  label: z.string().min(1).optional(),
  type: queryParamTypeSchema.optional(),
  aggregation: z.string().min(1).optional(),
}).strict();

export const stageChartInputSchema = z.object({
  goal_id: z.string().min(1).optional(),
  reason: z.string().optional(),
  skill_id: z.string().min(1).describe("Canonical skill id such as echarts-line, echarts-bar, echarts-kpi-text, or echarts-kpi-gauge."),
  title: z.string().min(1),
  description: z.string().optional(),
  target_view_id: z.string().min(1).optional(),
  datasource_id: z.string().min(1),
  table: z.string().min(1),
  data_mode: z.enum(["live", "mock"]).optional(),
  fields: z.object({
    time: stageChartFieldSchema.optional(),
    category: stageChartFieldSchema.optional(),
    metric: stageChartFieldSchema.optional(),
    value: stageChartFieldSchema.optional(),
  }).strict(),
  time_grain: z.enum(["day", "week", "month"]).optional(),
  sort: z.object({
    field_role: z.enum(["time", "category", "metric", "value"]).optional(),
    direction: z.enum(["asc", "desc"]).optional(),
  }).strict().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  filters: z.array(z.object({
    field: z.string().min(1),
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }).strict()).max(12).optional(),
  layout: z.object({
    desktop: partialLayoutItemSchema.optional(),
    mobile: partialLayoutItemSchema.optional(),
  }).strict().optional(),
  mock_data: z.object({
    rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  }).strict().optional(),
  mock_value: z.any().optional(),
}).strict();
