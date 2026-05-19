---
name: echarts-kpi-card
description: Create or revise refined ECharts KPI cards for headline numbers, totals, rates, and executive scorecards. Use for KPI, metric cards, headline metrics, 摘要指标, 核心指标, 数字卡片.
triggers: [kpi, metric, scorecard, headline, total, rate, 指标, 核心指标, 数字卡片]
---

# ECharts KPI Card Skill

Use this skill for compact KPI cards that should look like part of the polished report theme.

## stageChart Guidance

- Use `stageChart` for creation or revision; do not handwrite `renderer.option_template`.
- Pass `skill_id: "echarts-kpi-card"`.
- Required field mapping:
  - `fields.value.source_field`: source numeric field.
- Optional intent:
  - `fields.value.aggregation`: usually `sum`, `avg`, or `count`.
  - `mock_value`: use only for sample-mode drafts.

## Runtime Contract

- Runtime loads table schema, validates fields, generates SQL, query output, renderer slots, bindings, and layout.
- Do not provide SQL, `QueryDef.output`, binding selectors, renderer slots, or option template.

## Layout Defaults

- Desktop: `w: 3`, `h: 3`.
- Mobile: `w: 4`, `h: 3`.
