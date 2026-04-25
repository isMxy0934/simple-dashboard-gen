# Multi-Series Time Series

Use this reference for multiple metrics or grouped series over a shared time axis.

## Best Fit

- Two or more metrics over time.
- One metric split by a dimension such as region, channel, status, or segment.
- Comparisons where the shared time axis is the core of the analysis.

## Query Output Contract

Choose one of two shapes:

1. Wide rows for a small fixed set of metrics.
2. Long rows for a grouped or variable set of series.

Wide shape:

```json
{
  "reason": "Create multi-metric trend data.",
  "query": {
    "id": "q_multi_metric_trend",
    "name": "Multi Metric Trend",
    "datasource_id": "ds_example",
    "sql_template": "SELECT bucket_date, SUM(metric_a) AS metric_a, SUM(metric_b) AS metric_b FROM schema.table_name GROUP BY bucket_date ORDER BY bucket_date",
    "params": [],
    "output": {
      "kind": "rows",
      "schema": [
        { "name": "bucket_date", "type": "date", "nullable": false },
        { "name": "metric_a", "type": "number", "nullable": false },
        { "name": "metric_b", "type": "number", "nullable": false }
      ]
    }
  }
}
```

Long shape:

```json
{
  "reason": "Create grouped trend data.",
  "query": {
    "id": "q_grouped_metric_trend",
    "name": "Grouped Metric Trend",
    "datasource_id": "ds_example",
    "sql_template": "SELECT bucket_date, series_name, SUM(metric) AS metric_value FROM schema.table_name GROUP BY bucket_date, series_name ORDER BY bucket_date, series_name",
    "params": [],
    "output": {
      "kind": "rows",
      "schema": [
        { "name": "bucket_date", "type": "date", "nullable": false },
        { "name": "series_name", "type": "string", "nullable": false },
        { "name": "metric_value", "type": "number", "nullable": false }
      ]
    }
  }
}
```

## Binding Contract

- Bind the shared time field once.
- Bind each metric/series to a supported renderer slot.
- If the renderer cannot safely express multiple series, split into separate views instead of forcing unsupported slots.

## Defaults

- Use separate views when metrics have very different units or scales.
- Use one multi-series chart when the units match and comparison on the same axis is useful.
- Keep legends short; avoid too many series in one view.
