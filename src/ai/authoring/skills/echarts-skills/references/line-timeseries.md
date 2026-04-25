# Line Timeseries Chart

Use this reference for a trend over time.

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

Canonical query:

```json
{
  "reason": "Create weekly sales trend data.",
  "query": {
    "id": "q_weekly_orders",
    "name": "Weekly Orders",
    "datasource_id": "ds_example",
    "sql_template": "SELECT week_start, SUM(orders) AS orders FROM public.sales_weekly_fact GROUP BY week_start ORDER BY week_start",
    "params": [],
    "output": {
      "kind": "rows",
      "schema": [
        { "name": "week_start", "type": "date", "nullable": false },
        { "name": "orders", "type": "number", "nullable": false }
      ]
    }
  }
}
```

## Binding Guidance

- Bind the time field to the x-axis category/time slot.
- Bind the numeric metric to the value slot.
- Only add extra series bindings when the renderer contract supports them and the user asked for them.

## UX Notes

- Title should name the metric and period.
- If buckets can be missing, decide whether gaps should render as gaps or zeros; do not guess silently.
