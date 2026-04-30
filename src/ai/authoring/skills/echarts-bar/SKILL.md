---
name: echarts-bar
description: Create or revise ECharts category bar charts. Use for bar charts, category comparisons, rankings, top-N reports, 柱状图, 条形图, 排行, 排名.
triggers: [bar, ranking, rank, top-n, category, comparison, 柱状, 柱状图, 条形, 条形图, 排行, 排名]
---

# ECharts Bar Skill

Use this skill for comparing values across discrete categories.

## Best Fit

- Ranking or top-N views.
- Category comparison.
- Segment performance snapshot.
- Distribution across named groups.

## Renderer Guidance

- `renderer.kind` must be `echarts`.
- Use one metric and one category axis for the first draft.
- Prefer a simple horizontal or vertical bar chart.
- Sort intentionally if the user asked for ranking or top-N.
- Avoid stacked or grouped bars unless explicitly requested.
- Required slots:
  - `category`: array value under an x-axis, y-axis, or label path.
  - `value`: array value under a series path.

## Query Output Contract

- Return one row per category.
- Include one category field and one numeric metric field.
- Sort intentionally when the user asks for ranking or top-N.
- Use `output.kind = "rows"` with explicit `schema`.
- Limit category count when the chart would become unreadable.

Example query shape:

```json
{
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

## Binding Guidance

- Bind the category field to an array slot using a selector such as `rows[].category_name`.
- Bind the numeric metric to an array slot using a selector such as `rows[].metric_value`.
- Always include `param_mapping`; use `{}` when the query has no params.
- Add labels only when they improve readability.

## Layout Defaults

- Desktop: `w: 6`, `h: 6`.
- Mobile: `w: 4`, `h: 6`.

## UX Notes

- Long category labels favor horizontal bars.
- If there are too many categories, reduce scope instead of squeezing unreadable bars into the chart.
