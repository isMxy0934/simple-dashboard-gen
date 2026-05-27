---
name: stat-kpi
description: Create or revise a single headline metric view. Use for totals, rates, counts, current values, and executive KPI cells.
triggers: [kpi, metric, scorecard, headline, total, rate, count, 指标, 核心指标, 数字卡片]
---

# Stat KPI View Skill

Use this skill when the user needs one headline number.

## Best Fit

- Total sales, total orders, conversion rate, active users, average order value.
- One metric that should be read quickly.
- Executive summary stat cells.

## Avoid

- Time series questions; use `time-trend`.
- Comparing categories or regions; use `category-comparison` or `ranked-bar`.
- Multi-step operational narratives; use `signal-list`.

## stageViewIntent Guidance

- Use `stageViewIntent`.
- Pass `view_kind: "stat_kpi"`.
- Required field mapping:
  - `fields.value.source_field`: numeric source field.
- Common aggregation:
  - `sum` for totals.
  - `avg` for rates or average values.
  - `count` for row counts.

## Runtime Contract

- Do not provide renderer, recipe, layout, style, slots, bindings, or SQL.
- The active Design Kit decides the visual implementation.
