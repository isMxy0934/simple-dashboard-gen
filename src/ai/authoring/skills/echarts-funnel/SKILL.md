---
name: echarts-funnel
description: Create or revise ECharts funnel charts for conversion, pipeline, progression, and drop-off analysis. Use for funnel, conversion, pipeline, stage drop-off, 漏斗, 转化, 阶段.
triggers: [funnel, conversion, pipeline, stage, dropoff, drop-off, 漏斗, 转化, 阶段]
---

# ECharts Funnel Skill

Use this skill for ordered stage conversion or drop-off views.

## Selection Guidance

- Use this only when categories are sequential stages in a funnel, pipeline, or conversion journey.
- Prefer `echarts-ranked-bar` for ordinary top-N/category comparisons.
- Prefer `echarts-signal-list` for issue/risk rows that are not a strict funnel.

## stageChart Guidance

- Use `stageChart` for creation or revision; do not handwrite `renderer.option_template`.
- Pass `skill_id: "echarts-funnel"`.
- Required field mappings:
  - `fields.category.source_field`: funnel stage label.
  - `fields.metric.source_field`: stage count, value, or rate.
- Optional intent:
  - `fields.metric.aggregation`: usually `sum` or `count`.
  - `sort.direction`: usually `desc` for stage magnitude.
  - `limit`: keep to the actual funnel stages.

## Runtime Contract

- Runtime loads table schema, validates fields, generates SQL, query output, renderer slots, bindings, and layout.
- Do not provide SQL, `QueryDef.output`, binding selectors, renderer slots, or option template.

## Layout Defaults

- Desktop: `w: 6`, `h: 5`.
- Mobile: `w: 4`, `h: 5`.
