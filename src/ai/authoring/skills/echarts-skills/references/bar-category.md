# Category Bar Chart

Use this reference for comparing values across discrete categories.

```json skill-check
{
  "kind": "echarts-view",
  "supported_view_type": "bar-category",
  "required_renderer_kind": "echarts",
  "series_type": "bar",
  "option_keys": ["xAxis", "yAxis", "series"],
  "paired_data_formats": ["data-format-skills/category-series"],
  "required_slots": [
    { "role": "category", "value_kind": "array", "path_includes": "xAxis" },
    { "role": "value", "value_kind": "array", "path_includes": "series" }
  ],
  "default_layout": {
    "desktop": { "w": 6, "h": 6 },
    "mobile": { "w": 4, "h": 6 }
  },
  "unsupported_message": "Category bar views are supported; load this reference before creating rankings or category comparisons."
}
```

## Best Fit

- Ranking or top-N views
- Category comparison
- Segment performance snapshot
- Distribution across named groups

## Renderer Guidance

- Prefer a simple horizontal or vertical bar chart.
- Use one metric and one category axis for v1.
- Sort intentionally if the user asked for ranking or top-N.
- Avoid stacked or grouped bars unless explicitly requested.

## Data Contract Guidance

- Return one row per category.
- Include one category field and one numeric metric field.
- If top-N is intended, make the query enforce it explicitly.
- Keep numeric values raw.
- Use `output.kind = "rows"` with `schema` for every category query.
- Pair this with `data-format-skills/category-series` for reusable query output and binding shape.

## Binding Guidance

- Bind the category field to an array slot under `xAxis`, using `rows[].category_field`.
- Bind the numeric metric to an array slot under `series`, using `rows[].metric_field`.
- Add labels only when they improve readability.

## UX Notes

- Long category labels favor horizontal bars.
- If there are too many categories, reduce scope instead of squeezing unreadable bars into the chart.
