# Line Timeseries Chart

Use this reference for a trend over time.

```json skill-check
{
  "kind": "echarts-view",
  "chart_type": "line",
  "intent_aliases": ["line", "trend", "timeseries", "time series", "折线", "折线图", "趋势", "时间序列"],
  "data_shape": "time_series",
  "supports_create": true,
  "supports_revise": true,
  "supported_view_type": "line-timeseries",
  "required_renderer_kind": "echarts",
  "series_type": "line",
  "option_keys": ["xAxis", "yAxis", "series"],
  "paired_data_formats": ["data-format-skills/time-series"],
  "required_slots": [
    { "role": "time", "value_kind": "array", "path_includes": "xAxis" },
    { "role": "value", "value_kind": "array", "path_includes": "series" }
  ],
  "default_layout": {
    "desktop": { "w": 8, "h": 6 },
    "mobile": { "w": 4, "h": 6 }
  },
  "unsupported_message": "Line time-series views are supported; load this reference before creating weekly, daily, or monthly trend charts."
}
```

## Best Fit

- Daily, weekly, or monthly metric trend
- Week-over-week or period-over-period line comparison
- Time-based monitoring or growth analysis

## Renderer Guidance

- X-axis should represent time in a stable chronological order.
- Prefer one line for v1 unless the user explicitly asks for comparison series.
- Keep legend and tooltip simple.
- Do not overload the chart with too many derived annotations.

## Data Contract Guidance

- Return one row per time bucket.
- Include a clear time dimension field and one numeric metric field.
- If multiple series are needed, include a grouping field with explicit semantics.
- Ensure ordering can be derived reliably from the data.
- Use `output.kind = "rows"` with `schema` for every timeseries query.
- Pair this with `data-format-skills/time-series` for reusable query output and binding shape.

## Binding Guidance

- Bind the time field to an array slot under `xAxis`, using `rows[].time_field`.
- Bind the numeric metric to an array slot under `series`, using `rows[].metric_field`.
- Only add extra series bindings when the renderer contract supports them and the user asked for them.

## UX Notes

- Title should name the metric and period.
- If buckets can be missing, decide whether gaps should render as gaps or zeros; do not guess silently.
