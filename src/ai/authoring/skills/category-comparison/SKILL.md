---
name: category-comparison
description: Create or revise a category comparison view. Use for comparing a metric across regions, channels, products, segments, or other dimensions.
triggers: [compare, comparison, category, bar, dimension, segment, region, channel, 对比, 分类, 柱状图]
---

# Category Comparison View Skill

Use this skill when the user needs to compare values across categories.

## Best Fit

- Revenue by channel, orders by region, users by segment, or incidents by severity.
- Small to medium category sets where each category should be visible.
- Side-by-side comparison of one metric across one dimension.

## Avoid

- Ordered top-N lists; use `ranked-bar`.
- Time-based changes; use `time-trend`.
- One headline metric; use `stat-kpi`.

## stageViewIntent Guidance

- Use `stageViewIntent`.
- Pass `view_kind: "category_comparison"`.
- Required field mappings:
  - `fields.category.source_field`: categorical source field.
  - `fields.metric.source_field`: numeric metric source field.
- Common aggregation:
  - `sum` for totals per category.
  - `avg` for rates or average values per category.

## Runtime Contract

- Do not provide renderer, recipe, layout, style, slots, bindings, or SQL.
- The active Design Kit decides the visual implementation.
