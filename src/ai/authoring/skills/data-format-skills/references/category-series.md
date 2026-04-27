# Category Series

Use this reference for comparing one metric across discrete categories.

```json skill-check
{
  "kind": "data-format",
  "data_shape": "category-series",
  "view_support": "supported",
  "query_output": {
    "kind": "rows",
    "required_fields": [
      { "role": "category", "types": ["string"] },
      { "role": "metric", "types": ["number"] }
    ]
  }
}
```

## Best Fit

- Ranking, top-N, distribution, or segment comparison.
- Category snapshots such as region, channel, product, owner, or status.
- One metric where category differences are more important than time movement.

## Query Output Contract

- Return one row per category.
- Include one category field and one numeric metric field.
- Sort intentionally when the user asks for ranking or top-N.
- Use `output.kind = "rows"` with explicit `schema`.

```json
{
  "reason": "Create category comparison data.",
  "query": {
    "id": "q_category_metric",
    "name": "Category Metric",
    "datasource_id": "ds_example",
    "sql_template": "SELECT category_name, SUM(metric) AS metric_value FROM schema.table_name GROUP BY category_name ORDER BY metric_value DESC LIMIT 10",
    "params": [],
    "output": {
      "kind": "rows",
      "schema": [
        { "name": "category_name", "type": "string", "nullable": false },
        { "name": "metric_value", "type": "number", "nullable": false }
      ]
    }
  }
}
```

## Binding Contract

- Bind the category field to the category axis/label slot.
- Bind the numeric field to the value slot.
- Use `result_selector` when selecting arrays from rows: `rows[].category_name` for the category slot and `rows[].metric_value` for the value slot.

## Defaults

- Bar chart is the default visual for category comparison.
- Horizontal bars are better for long category labels.
- Limit category count when the chart would become unreadable.
- If the user asks for "all categories", include all categories only when the expected count is reasonable.
