---
name: funnel
description: Create or revise a funnel view. Use for ordered pipeline, conversion, onboarding, checkout, lead, or operational step drop-off analysis.
triggers: [funnel, conversion, pipeline, step, dropoff, drop-off, checkout, onboarding, 漏斗, 转化, 流程]
---

# Funnel View Skill

Use this skill when the user needs to compare ordered stages in a process.

## Best Fit

- Lead funnel, checkout steps, onboarding progress, pipeline stages, or conversion drop-off.
- Stage counts or values where stage order matters.
- Process health summaries.

## Avoid

- Unordered category comparison; use `category-comparison`.
- Ranked top-N categories; use `ranked-bar`.
- A bounded percentage without stages; use `bounded-gauge`.

## stageViewIntent Guidance

- Use `stageViewIntent`.
- Pass `view_kind: "funnel"`.
- Required field mappings:
  - `fields.category.source_field`: ordered stage source field.
  - `fields.metric.source_field`: numeric metric source field.
- Use the source stage field that already carries the intended business order when available.

## Runtime Contract

- Do not provide renderer, recipe, layout, style, slots, bindings, or SQL.
- The active Design Kit decides the visual implementation.
