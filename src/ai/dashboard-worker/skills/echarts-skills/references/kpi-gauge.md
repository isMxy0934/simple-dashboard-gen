# KPI Gauge

Use this reference for gauge or semicircle KPI cards when the user explicitly wants a gauge-style visualization.

## Recommended Slot

- `id: "gauge_value"`
- `path: "series[0].data[0].value"`
- `value_kind: "scalar"`

## Template Skeleton

```json
{
  "title": {
    "text": "Total GMV",
    "subtext": "GMV",
    "left": "center"
  },
  "series": [
    {
      "type": "gauge",
      "center": ["50%", "60%"],
      "radius": "90%",
      "startAngle": 180,
      "endAngle": 0,
      "min": 0,
      "max": 1000000,
      "detail": {
        "valueAnimation": true,
        "formatter": "{value}"
      },
      "data": [
        {
          "value": 0,
          "name": "GMV"
        }
      ]
    }
  ]
}
```

## Query Guidance

- Prefer `output.kind = "scalar"` for a true gauge KPI.
- Good SQL aliases:
  - `total_gmv`
  - `total_orders`

## Binding Guidance

- If the query returns `scalar`, keep `result_selector = null`.
- If the query returns `rows`, use `rows[0].metric_alias`.

## Common Errors

- `series[0].data[0].value` must already exist in the template.
- `series.data` is allowed; do not strip it from the template.
- Keep static labels like `name: "GMV"` in the template.
