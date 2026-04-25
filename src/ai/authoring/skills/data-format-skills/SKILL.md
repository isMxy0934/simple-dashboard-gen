---
name: data-format-skills
description: Use this skill when the agent needs reusable data-shape contracts for dashboard authoring, independent of any specific business template.
triggers: [kpi, metric, scalar, trend, timeseries, series, category, comparison, table, detail, rows, 指标, 趋势, 时间序列, 分类, 对比, 明细, 表格]
---

# Data Format Skills

Use this skill to choose a reusable data shape before creating queries, bindings, and views.

## Responsibility

- Pick the reference that matches the data shape the user requested.
- Keep business decisions in the model: choose metrics, fields, table, number of views, and titles from the user goal and schema.
- Use references only for reusable contracts: query output shape, binding shape, layout defaults, and formatting defaults.
- Do not treat a reference as a fixed business template.

## Reference Selection

- `scalar-kpi`: one headline metric or KPI card.
- `time-series`: one metric over time.
- `multi-series-time-series`: multiple metrics or grouped series over the same time axis.
- `category-series`: one metric compared across categories.
- `detail-rows`: row-level or aggregated detail records.

Load only the references that materially help the current draft. If the shape is obvious and already covered by loaded context, proceed without extra reference loading.

## General Rules

- Keep SQL values raw and typed. Use renderer/binding formatting for presentation.
- Use `output.kind = "scalar"` for one KPI value when no row fields are needed.
- Use `output.kind = "rows"` with `schema` for time series, category comparisons, multi-series, and detail rows.
- Make reversible choices by default: chart type, layout, labels, formatting, and simple fallbacks.
- Ask only when the missing information changes business meaning, not when it is a layout or formatting preference.
