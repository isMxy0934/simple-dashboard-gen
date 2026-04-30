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

## Renderer Guidance

- `renderer.kind` must be `echarts`.
- X-axis should represent time in a stable chronological order.
- Prefer one line for the first draft unless the user explicitly asks for comparison series.
- Keep legend and tooltip simple.
- Do not overload the chart with derived annotations.
- Required slots:
  - `time`: array value under an x-axis or category axis path.
  - `value`: array value under a series path.

## Query Output Contract

- Return one row per time bucket.
- Include one time field and one numeric metric field.
- Sort chronologically in SQL.
- Use `output.kind = "rows"` with explicit `schema`.
- Keep date/time values typed or consistently formatted; do not concatenate labels in SQL unless the source cannot return dates.

Example query shape:

```json
{
  "query": {
    "id": "q_metric_trend",
    "name": "Metric Trend",
    "datasource_id": "ds_example",
    "sql_template": "SELECT bucket_date, SUM(metric) AS metric_value FROM schema.table_name GROUP BY bucket_date ORDER BY bucket_date",
    "params": [],
    "output": {
      "kind": "rows",
      "schema": [
        { "name": "bucket_date", "type": "date", "nullable": false },
        { "name": "metric_value", "type": "number", "nullable": false }
      ]
    }
  }
}
```

## Binding Guidance

- Bind the time field to an array slot under `xAxis`, using a selector such as `rows[].bucket_date`.
- Bind the numeric metric to an array slot under `series`, using a selector such as `rows[].metric_value`.
- Always include `param_mapping`; use `{}` when the query has no params.
- Missing buckets should render as gaps unless metric semantics clearly make zero correct.

## Layout Defaults

- Desktop: `w: 8`, `h: 6`.
- Mobile: `w: 4`, `h: 6`.

## UX Notes

- Title should name the metric and period.
- If the user asks for weekly GMV, bucket by week and label the time field clearly.
