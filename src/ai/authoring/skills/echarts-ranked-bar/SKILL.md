---
name: echarts-ranked-bar
description: Create or revise ECharts horizontal ranked-bar cards for category-metric comparisons. Use for ranked list, top N, performance ranking, detail bars, 排名, 横向条形, 榜单, 明细对比.
triggers: [ranked, ranking, top, bar, horizontal, list, performance, 排名, 榜单, 横向, 条形, 明细]
---

# ECharts Ranked Bar Skill

Use this skill when the user wants a compact ranked comparison (labels + values), not a literal HTML table.

## Selection Guidance

- Use this for category/detail comparison where order matters and each row has one metric.
- Prefer `echarts-signal-list` when the rows represent risks, alerts, or operating issues.
- Prefer `echarts-funnel` only for ordered conversion stages or drop-off analysis.
- `echarts-data-table` is a deprecated legacy alias that resolves to this builder; new calls should use `echarts-ranked-bar`.

## stageChart Guidance

- Use `stageChart` for creation or revision; do not handwrite `renderer.option_template`.
- Pass `skill_id: "echarts-ranked-bar"`.
- Required field mappings:
  - `fields.category.source_field`: row label.
  - `fields.metric.source_field`: row value.
- Optional intent:
  - `fields.metric.aggregation`: usually `sum`, `avg`, or `count`.
  - `sort.direction`: use `desc` for top-ranked rows.
  - `limit`: keep to 5-12 rows for readability.

## Runtime Contract

- Runtime loads table schema, validates fields, generates SQL, query output, renderer slots, bindings, and layout.
- Do not provide SQL, `QueryDef.output`, binding selectors, renderer slots, or option template.

## Layout Defaults

- Desktop: `w: 6`, `h: 5`.
- Mobile: `w: 4`, `h: 5`.
