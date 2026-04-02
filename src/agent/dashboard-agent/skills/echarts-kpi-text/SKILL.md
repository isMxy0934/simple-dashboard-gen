# echarts-kpi-text

Use this skill for KPI cards, metric cards, and single-number summary tiles.

## When To Use

- The user asks for a KPI, indicator card, metric card, or headline number.
- The output is one scalar value such as total GMV, total orders, average price, or conversion rate.
- Prefer this skill over `echarts-kpi-gauge` unless the user explicitly asks for a gauge or semicircle meter.

## Contract Pattern

- `renderer.kind` must be `echarts`.
- Persist a raw ECharts template in `option_template`.
- The template must already contain the node referenced by the slot path.
- Recommended slot:
  - `id: "value"`
  - `path: "graphic.elements[0].style.text"`
  - `value_kind: "scalar"`

## Recommended Template Skeleton

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
- Good SQL alias examples:
  - `select sum(gmv) as total_gmv from sales_weekly_fact`
  - `select sum(orders) as total_orders from sales_weekly_fact`

## Binding Guidance

- If the query already returns `scalar`, keep `result_selector = null`.
- If the query returns `rows` with one metric column, use:
  - `result_selector = "rows[0].total_gmv"`
  - or `result_selector = "rows[0].total_orders"`

## Common Errors

- Do not target a slot path that does not exist in `option_template`.
- Do not rely on renderer template fields to infer query schema.
- Do not use `field_mapping`.

