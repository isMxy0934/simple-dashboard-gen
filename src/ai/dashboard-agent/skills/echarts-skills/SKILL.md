---
name: echarts-skills
description: Use this skill when the dashboard-agent needs ECharts-specific authoring guidance for KPI cards, gauges, line charts, or bar charts while keeping view, query, and binding contracts explicit.
---

# ECharts Skills

Use this skill when the user clearly wants an ECharts-based chart and the agent needs chart-specific authoring guidance before staging contracts.

## Core Rules

- Skills provide instructions only. Always stage contracts through `upsertView`, `upsertQuery`, `upsertBinding`, and validate through `runCheck`.
- Keep `renderer.kind = "echarts"`.
- Treat `option_template` as raw persisted ECharts JSON.
- Only bind to slot paths that already exist in the template.
- Do not infer query schema from renderer templates.
- Do not use `field_mapping`.
- Prefer SQL aliases, `output.schema`, and `result_selector` to make query output match the renderer contract.

## Reference Selection

Load exactly one reference file based on the requested chart shape:

- KPI or metric card:
  use `loadSkillReference` with `reference_name = "kpi-text"`
- Gauge, semicircle gauge, or dashboard meter:
  use `loadSkillReference` with `reference_name = "kpi-gauge"`
- Line chart, trend, time series, or week-over-week view:
  use `loadSkillReference` with `reference_name = "line-timeseries"`
- Bar chart, category comparison, ranking, or top-N chart:
  use `loadSkillReference` with `reference_name = "bar-category"`

If the user only asks for a generic chart or report, inspect the requested metric and grouping first, then choose one reference.

## Standard Flow

1. Inspect the current dashboard state and datasource schema when needed.
2. Load this skill.
3. Load the one reference that matches the requested chart type.
4. Stage explicit `query`, `view`, and `binding` contracts.
5. Run `runCheck` before proposing or applying the patch.
