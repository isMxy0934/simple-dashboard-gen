---
name: echarts-skills
description: Use this skill when the user wants to create a dashboard report or chart with the ECharts renderer.
triggers: [chart, charts, echarts, kpi, metric, gauge, line, trend, timeseries, bar, ranking, top-n, 图, 图表, 趋势, 柱状, 折线, 指标, 仪表, 排行]
---

# ECharts Skills

Use this skill when the user clearly wants an ECharts-based chart and the agent needs chart-type-specific guidance.

## Responsibility

- Identify the requested ECharts chart type.
- Load exactly one matching reference file.
- Use that reference to create the requested chart type.
- If the requested type is not supported, say so clearly instead of guessing.
- Always create data with the canonical `QueryDef` contract.
- Always create views with the canonical ECharts renderer contract.

## Canonical Query Contract

`upsertQuery` accepts only `{ reason?, query }`.

`query` must contain:

```json
{
  "id": "q_example",
  "name": "Example Query",
  "datasource_id": "ds_example",
  "sql_template": "SELECT 1 AS value",
  "params": [],
  "output": {
    "kind": "scalar",
    "value_type": "number"
  }
}
```

Never use `query_spec`, `sql`, `parameters`, top-level `output`, `output.kind = "table"`, or `output.fields`.

Use `output.kind = "rows"` with `schema` for table, trend, category, and multi-column result sets. Use `output.kind = "scalar"` with `value_type` for one KPI value.

## Canonical View Renderer Contract

`upsertView` accepts only `{ request, view_spec, layout? }`.

`view_spec.renderer.kind` must always be `echarts`; do not use chart names such as `kpi-text`, `bar`, or `line` as the renderer kind. Put chart shape in `option_template`.

`view_spec.renderer.option_template` is required and must contain every node referenced by `renderer.slots[].path`.

## Canonical Binding Contract

`upsertBinding` accepts only `{ reason?, binding }`.

Live bindings must include `query_id` and `param_mapping`; use `param_mapping: {}` when the query has no params.

Only use `result_selector` for `rows` query outputs. For `scalar`, `array`, or `object` query outputs, omit `result_selector` or set it to `null`.

## Supported Chart Types

- KPI text card
- KPI gauge
- Line timeseries chart
- Category bar chart

## Reference Selection

- For KPI or metric card, load `kpi-text`
- For gauge, semicircle gauge, or dashboard meter, load `kpi-gauge`
- For line chart, trend, time series, or week-over-week view, load `line-timeseries`
- For bar chart, category comparison, ranking, or top-N chart, load `bar-category`

If the user only asks for a generic chart or report, inspect the requested metric and grouping first, then choose one supported reference.

If the user explicitly asks for a type outside the list above, say that the current internal ECharts skill does not support that chart type yet.

## Flow

1. Load this skill.
2. Identify the requested chart type.
3. Load exactly one matching reference.
4. If no reference matches, tell the user the type is unsupported.
