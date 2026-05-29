---
name: time-trend
description: Create or revise a metric-over-time view. Use for trends, time series, growth, and period-over-period movement.
triggers: [trend, timeseries, time-series, line, growth, daily, weekly, monthly, 趋势, 时间序列, 折线]
---

# Time Trend View Skill

Use this skill when the user needs to understand how a metric changes over time.

## Best Fit

- Daily, weekly, or monthly revenue, orders, users, conversion, or rate trends.
- Growth or decline over a selected period.
- Period-over-period monitoring.

## Avoid

- A single current value; use `stat-kpi`.
- Ranking categories; use `ranked-bar`.
- Stage-by-stage conversion; use `funnel`.

## stageViewIntent Guidance

- Use `stageViewIntent`.
- Pass `view_kind: "time_trend"`.
- Required field mappings:
  - `fields.time.source_field`: date or datetime source field.
  - `fields.metric.source_field`: numeric metric source field.
- Common aggregation:
  - `sum` for totals over each time bucket.
  - `avg` for rates or average values.
- Use `fields.time.time_grain` when the user asks for daily, weekly, or monthly buckets.

## Runtime Contract

- Do not provide renderer, recipe, layout, style, slots, bindings, or SQL.
- The active dashboard template decides the visual implementation.
