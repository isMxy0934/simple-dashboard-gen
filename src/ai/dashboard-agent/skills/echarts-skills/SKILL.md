---
name: echarts-skills
description: Use this skill when the user wants to create a dashboard report or chart with the ECharts renderer.
---

# ECharts Skills

Use this skill when the user clearly wants an ECharts-based chart and the agent needs chart-type-specific guidance.

## Responsibility

- Identify the requested ECharts chart type.
- Load the one matching reference file.
- Use that reference to create the requested chart type.
- If the requested type is not supported, say so clearly and stop instead of guessing.

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
