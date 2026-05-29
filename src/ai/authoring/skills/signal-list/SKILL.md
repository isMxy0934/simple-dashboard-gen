---
name: signal-list
description: Create or revise a prioritized signal list. Use for operational highlights, alerts, exceptions, watchlists, and key items needing attention.
triggers: [signal, signals, alert, alerts, exception, watchlist, list, highlights, 异常, 信号, 列表, 预警]
---

# Signal List View Skill

Use this skill when the user needs a concise list of notable categories or items.

## Best Fit

- Operational exceptions, watchlists, priority accounts, stores needing attention, or alert summaries.
- Lists where each row has a label and metric.
- Status-oriented summaries that should be scanned quickly.

## Avoid

- A single headline metric; use `stat-kpi`.
- Trend analysis; use `time-trend`.
- Stage conversion analysis; use `funnel`.

## stageViewIntent Guidance

- Use `stageViewIntent`.
- Pass `view_kind: "signal_list"`.
- Required field mappings:
  - `fields.category.source_field`: item, segment, or category source field.
  - `fields.metric.source_field`: numeric metric source field.
- Use `limit` when the user asks for a short watchlist or priority list.

## Runtime Contract

- Do not provide renderer, recipe, layout, style, slots, bindings, or SQL.
- The active dashboard template decides the visual implementation.
