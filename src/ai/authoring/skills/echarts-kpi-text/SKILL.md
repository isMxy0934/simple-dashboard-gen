---
name: echarts-kpi-text
description: Create or revise ECharts KPI text cards for one headline metric. Use for KPI, metric cards, scorecards, 指标, 指标卡, 卡片, total/average/rate summary values.
triggers: [kpi, metric-card, scorecard, 指标, 指标卡, 卡片]
---

# ECharts KPI Text Skill

Use this skill for a single headline metric shown as a text-first ECharts view.

## Selection Guidance

- Use this for plain legacy-compatible KPI text tiles.
- Prefer `echarts-kpi-card` when the dashboard should match the polished report template.
- Prefer `echarts-kpi-gauge` only for bounded progress, score, or utilization.

## Best Fit

- One primary number.
- Optional short label.
- Optional delta or comparison note.
- Dashboard hero metric, summary card, or compact status tile.

## stageChart Guidance

- Use `stageChart` for creation or revision; do not handwrite `renderer.option_template`.
- Pass `skill_id: "echarts-kpi-text"`.
- Prefer a minimal renderer with one dominant value and one small supporting label.
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

- Desktop: `w: 4`, `h: 3`.
- Mobile: `w: 4`, `h: 3`.

## UX Notes

- Title should state what the metric represents.
- Subtitle should explain period or scope if needed.
- If the value can be null, provide a safe fallback label rather than inventing data.
