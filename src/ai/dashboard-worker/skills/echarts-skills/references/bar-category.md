# Bar Category

Use this reference for category comparison charts such as region GMV, channel orders, or top-N bars.

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
      "type": "bar",
      "encode": {
        "x": "category",
        "y": "value"
      }
    }
  ]
}
```

## Query Guidance

- Use `output.kind = "rows"`.
- Alias the dimension to `category` and the metric to `value` unless there is a strong reason not to.

## Binding Guidance

- Bind directly to `dataset.source`.
- Keep `result_selector = null`.

## Common Errors

- `dataset.source` must exist before binding.
- Keep `encode` aligned with the SQL aliases or update `encode` explicitly.
