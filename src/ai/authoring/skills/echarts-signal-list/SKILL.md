---
name: echarts-signal-list
description: Create or revise ECharts operating signal lists using ranked category-metric rows. Use for operational signals, issue lists, alerts, risks, ranked signals, 运营信号, 问题列表, 风险列表.
triggers: [signals, signal, issues, risks, alerts, operating, operations, 运营信号, 问题, 风险, 异常]
---

# ECharts Signal List Skill

Use this skill for operational signal cards that should be rendered by ECharts rather than CSS lists.

## Selection Guidance

- Use this for ranked risks, alerts, anomalies, issues, or action-worthy operating signals.
- Prefer `echarts-ranked-bar` for neutral category rankings or detail comparisons.
- Prefer `echarts-funnel` when the rows are conversion stages with expected progression.

## stageChart Guidance

- Use `stageChart` for creation or revision; do not handwrite `renderer.option_template`.
- Pass `skill_id: "echarts-signal-list"`.
- Required field mappings:
  - `fields.category.source_field`: signal, issue, segment, or dimension label.
  - `fields.metric.source_field`: score, count, revenue, risk value, or priority metric.
- Optional intent:
  - `fields.metric.aggregation`: usually `sum`, `avg`, or `count`.
  - `sort.direction`: usually `desc`.
  - `limit`: prefer 3-8 signals so the card stays readable.

## Runtime Contract

- Runtime loads table schema, validates fields, generates SQL, query output, renderer slots, bindings, and layout.
- Do not provide SQL, `QueryDef.output`, binding selectors, renderer slots, or option template.

## Layout Defaults

- Desktop: `w: 4`, `h: 6`.
- Mobile: `w: 4`, `h: 6`.
