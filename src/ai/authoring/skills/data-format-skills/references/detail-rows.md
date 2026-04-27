# Detail Rows

Use this reference for row-level or aggregated detail data.

```json skill-check
{
  "kind": "data-format",
  "data_shape": "detail-rows",
  "view_support": "data-only",
  "unsupported_message": "Detail table views are not supported by the current renderer contract yet.",
  "query_output": {
    "kind": "rows",
    "required_fields": [
      { "role": "detail", "types": ["string", "number", "boolean", "date", "datetime"] }
    ]
  }
}
```

## Best Fit

- Detail lists, audit views, recent records, or drilldown support.
- A table-like result where users need to inspect rows rather than a single chart shape.
- Intermediate data exploration before deciding the final chart.

## Query Output Contract

- Return `output.kind = "rows"` with explicit `schema`.
- Keep each field typed and raw.
- Include stable ordering when the rows represent recent records or ranked records.
- Limit rows for first drafts unless the user explicitly asks for export-like volume.

```json
{
  "reason": "Create detail rows.",
  "query": {
    "id": "q_detail_rows",
    "name": "Detail Rows",
    "datasource_id": "ds_example",
    "sql_template": "SELECT dimension_a, dimension_b, metric_value FROM schema.table_name ORDER BY metric_value DESC LIMIT 50",
    "params": [],
    "output": {
      "kind": "rows",
      "schema": [
        { "name": "dimension_a", "type": "string", "nullable": false },
        { "name": "dimension_b", "type": "string", "nullable": true },
        { "name": "metric_value", "type": "number", "nullable": false }
      ]
    }
  }
}
```

## Binding Contract

- If a table renderer is unavailable, do not invent a non-canonical renderer kind.
- For ECharts-only dashboards, use a chart shape that honestly summarizes the rows, or explain that detail-table rendering is not supported by the current renderer contract.
- Keep detail-row queries available for future table support when useful, but do not bind them to unsupported slots.

## Defaults

- First draft row limit: 50 rows unless the user specifies otherwise.
- Use clear business column names in descriptions/titles, but keep SQL aliases simple and stable.
- Avoid dense row output when a KPI, trend, or category chart better answers the user goal.
