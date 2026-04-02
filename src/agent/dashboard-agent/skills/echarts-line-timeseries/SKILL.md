# echarts-line-timeseries

Use this skill for line charts that show a trend over time.

## When To Use

- The user asks for a trend, time series, week-over-week chart, or 折线图.
- The query should return rows.

## Contract Pattern

- `renderer.kind` must be `echarts`.
- Prefer a dataset-driven raw ECharts template.
- Recommended slot:
  - `id: "rows"`
  - `path: "dataset.source"`
  - `value_kind: "rows"`

## Recommended Template Skeleton

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
- SQL aliases must match the ECharts encode fields.
- Recommended aliases:
  - time field: `week_start`
  - metric field: `value`

Example:

```sql
select week_start, sum(gmv) as value
from sales_weekly_fact
group by week_start
order by week_start asc
```

## Binding Guidance

- Bind the query directly to the `rows` slot.
- Keep `result_selector = null`.

## Common Errors

- `dataset.source` must already exist in the template.
- Do not use `field_mapping`; use SQL aliases and `encode`.
- If the query returns a different field name, change the SQL alias or the `encode` mapping.

