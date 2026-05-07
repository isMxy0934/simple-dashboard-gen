---
name: echarts-line
description: Create or revise ECharts line and time-series charts. Use for line charts, trend charts, 折线图, 趋势图, 时间序列, daily/weekly/monthly GMV or metric trends.
triggers: [line, trend, timeseries, time-series, 折线, 折线图, 趋势, 趋势图, 时间序列]
---

# ECharts Line Skill

Use this skill for one metric over time, such as daily, weekly, or monthly trends.

## Best Fit

- Daily, weekly, or monthly metric trend.
- Week-over-week or period-over-period line comparison.
- Time-based monitoring or growth analysis.

## stageChart Guidance

- Use `stageChart` for creation or revision; do not handwrite `renderer.option_template`.
- Pass `skill_id: "echarts-line"`.
- X-axis should represent time in a stable chronological order.
- Prefer one line for the first draft unless the user explicitly asks for comparison series.
- Keep legend and tooltip simple.
- Do not overload the chart with derived annotations.
- Required field mappings:
  - `fields.time.source_field`: source date/datetime field.
  - `fields.metric.source_field`: source numeric metric field.
- Optional intent:
  - `time_grain`: `day`, `week`, or `month` when the user asks for a period bucket.
  - `fields.metric.aggregation`: usually `sum` for totals, `avg` for rates/scores.

## Runtime Contract

- Runtime loads table schema, validates fields, generates SQL, query output, renderer slots, bindings, and layout.
- Do not provide SQL, `QueryDef.output`, binding selectors, renderer slots, or option template.
- Missing buckets should render as gaps unless metric semantics clearly make zero correct.

## Binding Guidance

- `stageChart` builds renderer slots and live bindings.

## Layout Defaults

- Desktop: `w: 8`, `h: 6`.
- Mobile: `w: 4`, `h: 6`.

## UX Notes

- Title should name the metric and period.
- If the user asks for weekly GMV, bucket by week and label the time field clearly.
