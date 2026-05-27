---
name: echarts-kpi-text
description: Create or revise ECharts KPI text cards for one headline metric. Use for KPI, metric cards, scorecards, 指标, 指标卡, 卡片, total/average/rate summary values.
triggers: [kpi, metric-card, scorecard, 指标, 指标卡, 卡片]
---

# ECharts KPI Text Skill

This skill is a compatibility alias for the report KPI card recipe. It must produce the
same shell/body ownership as `echarts-kpi-card`.

## Selection Guidance

- Prefer `echarts-kpi-card` for new work.
- If this skill is selected, runtime still emits the unified report KPI card renderer.
- Prefer `echarts-kpi-gauge` only for bounded progress, score, or utilization.

## Best Fit

- One primary number.
- Optional short label.
- Optional delta or comparison note.
- Dashboard hero metric, summary card, or compact status tile.

## stageChart Guidance

- Use `stageChart` for creation or revision; do not handwrite `renderer.option_template`.
- Pass `skill_id: "echarts-kpi-text"` only when revising an existing request that named it.
- Do not render title, subtitle, status, or card chrome inside the ECharts body.
- Prefer a minimal renderer with one dominant value.
- Avoid axes, legends, or dense decorative structure.
- Keep the card readable at small sizes.
- Required field mapping:
  - `fields.value.source_field`: source numeric metric field.
- Optional intent:
  - `fields.value.aggregation`: usually `sum` for totals, `avg` for rates/scores.
  - `filters`: use only when the user specified a real subset.

## Runtime Contract

- Runtime loads table schema, validates fields, generates scalar SQL/query output, renderer slots, bindings, and layout.
- Do not provide SQL, `QueryDef.output`, binding selectors, renderer slots, or option template.
- Keep the primary metric numeric; prefer renderer formatting for currency, percent, or integer display.

## Binding Guidance

- `stageChart` builds renderer slots and live bindings.

## Layout Defaults

- Desktop follows the unified KPI card recipe.
- Mobile follows the unified KPI card recipe.

## UX Notes

- Title should state what the metric represents.
- Subtitle should explain period or scope if needed.
- If the value can be null, provide a safe fallback label rather than inventing data.
