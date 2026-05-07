---
name: echarts-bar
description: Create or revise ECharts category bar charts. Use for bar charts, category comparisons, rankings, top-N reports, 柱状图, 条形图, 排行, 排名.
triggers: [bar, ranking, rank, top-n, category, comparison, 柱状, 柱状图, 条形, 条形图, 排行, 排名]
---

# ECharts Bar Skill

Use this skill for comparing values across discrete categories.

## Best Fit

- Ranking or top-N views.
- Category comparison.
- Segment performance snapshot.
- Distribution across named groups.

## stageChart Guidance

- Use `stageChart` for creation or revision; do not handwrite `renderer.option_template`.
- Pass `skill_id: "echarts-bar"`.
- Use one metric and one category axis for the first draft.
- Prefer a simple horizontal or vertical bar chart.
- Sort intentionally if the user asked for ranking or top-N.
- Avoid stacked or grouped bars unless explicitly requested.
- Required field mappings:
  - `fields.category.source_field`: source category/dimension field.
  - `fields.metric.source_field`: source numeric metric field.
- Optional intent:
  - `fields.metric.aggregation`: usually `sum` for totals, `avg` for rates/scores.
  - `limit`: use a small top-N such as 10 when the chart would otherwise be unreadable.
  - `sort.direction`: usually `desc` for rankings.

## Runtime Contract

- Runtime loads table schema, validates fields, generates SQL, query output, renderer slots, bindings, and layout.
- Do not provide SQL, `QueryDef.output`, binding selectors, renderer slots, or option template.
- Runtime returns one row per category and limits category count when requested.

## Binding Guidance

- `stageChart` builds renderer slots and live bindings.
- Add labels only when they improve readability.

## Layout Defaults

- Desktop: `w: 6`, `h: 6`.
- Mobile: `w: 4`, `h: 6`.

## UX Notes

- Long category labels favor horizontal bars.
- If there are too many categories, reduce scope instead of squeezing unreadable bars into the chart.
