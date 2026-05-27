---
name: ranked-bar
description: Create or revise a ranked category view. Use for top-N, bottom-N, leaderboards, and sorted metric comparisons.
triggers: [rank, ranking, top, bottom, leaderboard, top-n, sorted, 排名, 排行, 前几名]
---

# Ranked Bar View Skill

Use this skill when the user needs the highest or lowest categories by a metric.

## Best Fit

- Top products by revenue, top regions by orders, worst stores by SLA, or bottom campaigns by conversion.
- Leaderboards and focused top-N summaries.
- Category comparisons where sort order is the main point.

## Avoid

- Unsorted category comparisons; use `category-comparison`.
- Time-based trends; use `time-trend`.
- Multi-stage conversion paths; use `funnel`.

## stageViewIntent Guidance

- Use `stageViewIntent`.
- Pass `view_kind: "ranked_bar"`.
- Required field mappings:
  - `fields.category.source_field`: categorical source field.
  - `fields.metric.source_field`: numeric metric source field.
- Use `sort.direction: "desc"` and a small `limit` for top-N requests.
- Use `sort.direction: "asc"` for bottom-N requests.

## Runtime Contract

- Do not provide renderer, recipe, layout, style, slots, bindings, or SQL.
- The active Design Kit decides the visual implementation.
