# Category Bar Chart

Use this reference for comparing values across discrete categories.

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

## Binding Guidance

- Bind the category field to the category axis slot.
- Bind the numeric metric to the bar value slot.
- Add labels only when they improve readability.

## UX Notes

- Long category labels favor horizontal bars.
- If there are too many categories, reduce scope instead of squeezing unreadable bars into the chart.
