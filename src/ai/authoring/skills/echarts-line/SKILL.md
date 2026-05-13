---
name: echarts-line
description: Create or revise ECharts line and time-series charts. Use for line charts, trend charts, 折线图, 趋势图, 时间序列, daily/weekly/monthly GMV or metric trends, multi-series line charts, 多线折线图, comparison by dimension.
triggers: [line, trend, timeseries, time-series, 折线, 折线图, 趋势, 趋势图, 时间序列, multi-series, 多线, 多系列]
---

# ECharts Line Skill

Use this skill for one or more metrics over time, such as daily, weekly, or monthly trends.

## Best Fit

- Daily, weekly, or monthly metric trend.
- Week-over-week or period-over-period line comparison.
- Time-based monitoring or growth analysis.
- Multi-series comparison: same metric split by a categorical dimension (e.g. by region, product, channel).

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
- Optional field mappings:
  - `fields.series.source_field`: categorical dimension used to split data into multiple lines (e.g. `region`, `product_type`). When provided, the chart renders one line per distinct value of this dimension.
- Optional intent:
  - `time_grain`: `day`, `week`, or `month` when the user asks for a period bucket.
  - `fields.metric.aggregation`: usually `sum` for totals, `avg` for rates/scores.

## Multi-Series Mode

When `fields.series` is provided:

- SQL becomes long-format: `SELECT time_value, series_value, metric_value FROM ... GROUP BY 1, 2 ORDER BY 1`.
- The renderer carries `transforms` that pivot long-format rows into a wide ECharts dataset and generate one `line` series per distinct `series_value`.
- A legend is automatically shown.
- Do not combine multi-series with a high-cardinality dimension; prefer ≤ 10 distinct series values.

### Pivot Contract

The pivot happens in `src/renderers/echarts/browser/materialize-option.ts`:

1. Read a `pivot_rows` transform with `source_slot: "dataset"`, `row_key: "time_value"`, `column_key: "series_value"`, `value_field: "metric_value"`, and `target_path: "dataset.source"`.
2. Pivot long-format rows into wide-format `dataset.source` data (header row + data rows).
3. Read a later `generate_series` transform whose `source_transform` references the pivot transform.
4. Inject `series` with one `{ type: "line", name, encode: { x: "time_value", y: name } }` per unique series value.

The `option_template.series` in the stored document is intentionally `[]`; the real series are injected at render time.

## Runtime Contract

- Runtime loads table schema, validates fields, generates SQL, query output, renderer slots, bindings, and layout.
- Do not provide SQL, `QueryDef.output`, binding selectors, renderer slots, or option template.
- Missing buckets should render as gaps unless metric semantics clearly make zero correct.

## Binding Guidance

- Single-series: two bindings (`time` → `xAxis.data`, `value` → `series[0].data`).
- Multi-series: one binding (`dataset` → `dataset.source`) carrying all rows; renderer handles grouping.

## Layout Defaults

- Desktop: `w: 8`, `h: 6`.
- Mobile: `w: 4`, `h: 6`.

## UX Notes

- Title should name the metric and period.
- If the user asks for weekly GMV, bucket by week and label the time field clearly.
- For multi-series, include the dimension name in the title (e.g. "Weekly GMV by Region").
