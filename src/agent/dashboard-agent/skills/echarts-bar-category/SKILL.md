# echarts-bar-category

Use this skill for category comparison charts such as region GMV, channel orders, or top-N bars.

## When To Use

- The user asks for a bar chart, category comparison, ranking chart, or 柱状图.
- The query should return rows.

## Contract Pattern

- `renderer.kind` must be `echarts`.
- Prefer dataset-driven raw ECharts JSON.
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
- Alias the dimension to `category` and the metric to `value` unless there is a good reason not to.

Example:

```sql
select region as category, sum(gmv) as value
from sales_weekly_fact
group by region
order by value desc
```

## Binding Guidance

- Bind directly to `dataset.source`.
- Keep `result_selector = null`.

## Common Errors

- `dataset.source` must exist before binding.
- Do not use `field_mapping`.
- Keep `encode` aligned with SQL aliases or update `encode` explicitly.

