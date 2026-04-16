# KPI Text

Use this reference for KPI cards, metric cards, and single-number summary tiles.

## Recommended Slot

- `id: "value"`
- `path: "graphic.elements[0].style.text"`
- `value_kind: "scalar"`

## Template Skeleton

```json
{
  "title": {
    "text": "Total GMV",
    "left": "center",
    "top": 16
  },
  "graphic": {
    "elements": [
      {
        "type": "text",
        "left": "center",
        "top": "middle",
        "style": {
          "text": "0",
          "font": "700 42px sans-serif",
          "fill": "#1f2937"
        }
      }
    ]
  }
}
```

## Query Guidance

- Prefer `output.kind = "scalar"` when the SQL naturally returns one value.
- Good SQL aliases:
  - `total_gmv`
  - `total_orders`

## Binding Guidance

- If the query returns `scalar`, keep `result_selector = null`.
- If the query returns `rows`, use a selector such as:
  - `rows[0].total_gmv`
  - `rows[0].total_orders`

## Common Errors

- The slot path must already exist in `option_template`.
- Do not rely on renderer fields to infer query schema.
