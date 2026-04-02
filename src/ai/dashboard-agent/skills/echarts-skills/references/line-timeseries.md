# Line Timeseries

Use this reference for line charts that show a trend over time.

## Recommended Slot

- `id: "rows"`
- `path: "dataset.source"`
- `value_kind: "rows"`

## Template Skeleton

```json
{
  "tooltip": {
    "trigger": "axis"
  },
  "dataset": {
    "source": []
  },
  "xAxis": {
    "type": "category"
  },
  "yAxis": {
    "type": "value"
  },
  "series": [
    {
      "type": "line",
      "encode": {
        "x": "week_start",
        "y": "value"
      },
      "smooth": true
    }
  ]
}
```

## Query Guidance

- Use `output.kind = "rows"`.
- Make SQL aliases match `encode`.
- Recommended aliases:
  - time field: `week_start`
  - metric field: `value`

## Binding Guidance

- Bind the query directly to `dataset.source`.
- Keep `result_selector = null`.

## Common Errors

- `dataset.source` must already exist in the template.
- If the query returns different field names, fix the SQL aliases or update `encode`.
