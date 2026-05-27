---
name: bounded-gauge
description: Create or revise a bounded single-value view. Use for percentages, SLA, progress, utilization, quota attainment, and health against a known range.
triggers: [gauge, progress, percentage, percent, utilization, sla, quota, attainment, 仪表盘, 百分比, 进度, 达成率]
---

# Bounded Gauge View Skill

Use this skill when the user needs one bounded value with an implied minimum and maximum.

## Best Fit

- Conversion rate, SLA attainment, utilization, progress to goal, quota attainment, or health score.
- Percentages and ratios where the range is meaningful.
- A single metric where position within a range matters more than exact comparison.

## Avoid

- Unbounded totals or counts; use `stat-kpi`.
- Time-based progress; use `time-trend`.
- Stage conversion paths; use `funnel`.

## stageViewIntent Guidance

- Use `stageViewIntent`.
- Pass `view_kind: "bounded_gauge"`.
- Required field mapping:
  - `fields.value.source_field`: numeric bounded value source field.
- Use only for bounded values such as percentages, SLA, progress, or utilization.
- Common aggregation:
  - `avg` for rates, percentages, and scores.
  - `sum` only when the summed value still has a known business range.

## Runtime Contract

- Do not provide renderer, recipe, layout, style, slots, bindings, or SQL.
- The active Design Kit decides the visual implementation.
