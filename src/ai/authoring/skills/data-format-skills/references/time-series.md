# Time Series

Use this reference for one metric over time.

```json skill-check
{
  "kind": "data-format",
  "data_shape": "time-series",
  "view_support": "supported",
  "query_output": {
    "kind": "rows",
    "required_fields": [
      { "role": "time", "types": ["date", "datetime", "string"] },
      { "role": "metric", "types": ["number"] }
    ]
  }
}
```

## Best Fit

- Daily, weekly, monthly, or other bucketed trend.
- A single metric whose direction, seasonality, or recent movement matters.
- First draft trend views when the user does not ask for grouped comparison.

## Query Output Contract

- Return one row per time bucket.
- Include one time field and one numeric metric field.
- Sort chronologically in SQL.
- Use `output.kind = "rows"` with explicit `schema`.
- Keep date/time values typed or consistently formatted; do not concatenate labels in SQL unless the source cannot return dates.

```json
{
  "reason": "Create time series data.",
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

## Binding Contract

- Bind the time field to the x/category/time slot.
- Bind the numeric field to the metric/value slot.
- Use `result_selector` when selecting arrays from rows: `rows[].bucket_date` for the time slot and `rows[].metric_value` for the value slot.
- Always include `param_mapping`; use `{}` when there are no params.

## Defaults

- Line chart is the default visual for continuous time trends.
- If the user says "recent" and the data has a natural time field, use a small recent window only when the request implies freshness; otherwise explain the chosen period briefly.
- Missing buckets should render as gaps unless the metric semantics clearly make zero correct.
- Layout: trend views usually need more width than KPI cards.
