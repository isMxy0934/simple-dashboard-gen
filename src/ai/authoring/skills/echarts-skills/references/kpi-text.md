# KPI Text Card

Use this reference for a single headline metric shown as a text-first ECharts view.

## Best Fit

- One primary number
- Optional short label
- Optional delta or comparison note
- Dashboard hero metric, summary card, or compact status tile

## Renderer Guidance

- Prefer a minimal renderer with one dominant value and one small supporting label.
- Avoid axes, legends, or dense decorative structure.
- Keep the card readable at small sizes.

## Data Contract Guidance

- Prefer a scalar output for one headline number when the renderer slot expects a scalar.
- Use one-row `rows` output only when the binding needs `rows[0].metric_name` via `result_selector`.
- Keep the primary metric numeric.
- If a comparison is needed, return a separate numeric field for the previous value or delta basis.

Canonical scalar query:

```json
{
  "reason": "Create the primary KPI value.",
  "query": {
    "id": "q_total_orders",
    "name": "Total Orders",
    "datasource_id": "ds_example",
    "sql_template": "SELECT SUM(orders) AS total_orders FROM public.sales_weekly_fact",
    "params": [],
    "output": {
      "kind": "scalar",
      "value_type": "number"
    }
  }
}
```

Canonical one-row query:

```json
{
  "reason": "Create a KPI value that will be selected from the first row.",
  "query": {
    "id": "q_total_orders",
    "name": "Total Orders",
    "datasource_id": "ds_example",
    "sql_template": "SELECT SUM(orders) AS total_orders FROM public.sales_weekly_fact",
    "params": [],
    "output": {
      "kind": "rows",
      "schema": [
        { "name": "total_orders", "type": "number", "nullable": false }
      ]
    }
  }
}
```

## Binding Guidance

- Bind the main numeric field to the primary display slot.
- Bind label or subtitle fields separately.
- If the query uses one-row rows output for a scalar slot, set `result_selector` to `rows[0].total_orders`.
- Prefer renderer formatting for currency, percent, or integer display.

## UX Notes

- Title should state what the metric represents.
- Subtitle should explain period or scope if needed.
- If the value can be null, provide a safe fallback label rather than inventing data.
