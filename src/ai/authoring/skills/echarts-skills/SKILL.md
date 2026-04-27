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
- For reusable data output, binding, layout, or formatting defaults, use `data-format-skills` references instead of treating this skill as a business template.
- If the requested type is not supported, say so clearly instead of guessing.
- Follow the current write-tool descriptions and schemas for exact `upsertQuery`, `upsertView`, and `upsertBinding` input shape.

## Tool Contract Boundary

This skill does not own canonical tool input contracts. Tool descriptions and JSON schemas own those contracts. Use this skill only for chart-family guidance: renderer intent, option shape, slot purpose, and UX defaults.

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

For common data shapes, pair the renderer reference with a `data-format-skills` reference when it materially helps:

- KPI card -> `data-format-skills/scalar-kpi`
- Time trend -> `data-format-skills/time-series`
- Multi-metric or grouped trend -> `data-format-skills/multi-series-time-series`
- Category comparison -> `data-format-skills/category-series`

## Flow

1. Load this skill.
2. Identify the requested chart type.
3. Load exactly one matching reference.
4. If no reference matches, tell the user the type is unsupported.
