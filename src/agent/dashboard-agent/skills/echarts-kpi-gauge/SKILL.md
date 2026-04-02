# echarts-kpi-gauge

Use this skill for gauge or semicircle KPI cards when the user explicitly wants a gauge-style visualization.

## When To Use

- The user says gauge, meter, semicircle, dashboard meter, or 仪表盘.
- The chart shows one scalar metric.

## Contract Pattern

- `renderer.kind` must be `echarts`.
- `option_template` is raw ECharts JSON and may persist `series.data`.
- The slot must target an existing gauge value node.
- Recommended slot:
  - `id: "gauge_value"`
  - `path: "series[0].data[0].value"`
  - `value_kind: "scalar"`

## Recommended Template Skeleton

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

- Prefer `output.kind = "scalar"` for true KPI gauges.
- Good SQL alias examples:
  - `select sum(gmv) as total_gmv from sales_weekly_fact`
  - `select sum(orders) as total_orders from sales_weekly_fact`

## Binding Guidance

- If the query returns `scalar`, keep `result_selector = null`.
- If the query returns `rows`, use `result_selector = "rows[0].metric_alias"`.

## Common Errors

- `series[0].data[0].value` must already exist in the template.
- `series.data` is allowed; do not remove it just because it exists.
- Keep static labels such as `name: "GMV"` in the template.
- Do not use `field_mapping`.

