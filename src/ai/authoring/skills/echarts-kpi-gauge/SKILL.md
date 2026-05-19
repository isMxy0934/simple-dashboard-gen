---
name: echarts-kpi-gauge
description: Create or revise ECharts gauge KPI views for bounded progress, score, utilization, or target-attainment metrics. Use for gauge, meter, 仪表盘, 进度, 达成率.
triggers: [gauge, meter, progress, utilization, score, 仪表, 仪表盘, 进度, 达成率]
---

# ECharts KPI Gauge Skill

Use this skill for a single progress-like metric where a gauge communicates target attainment or bounded status.

## Selection Guidance

- Use this only for bounded values such as percent complete, utilization, score, or SLA attainment.
- Prefer `echarts-kpi-card` for unbounded totals, revenue, counts, and rates without a real target range.

## Best Fit

- Completion percentage.
- Utilization or capacity ratio.
- SLA attainment.
- Score on a bounded scale.

## stageChart Guidance

- Use `stageChart` for creation or revision; do not handwrite `renderer.option_template`.
- Pass `skill_id: "echarts-kpi-gauge"`.
- Prefer a semicircle or compact circular gauge.
- Show one clear primary value.
- Avoid multiple needles or multi-series complexity for the first draft.
- Include min/max or target semantics only if they are real business constraints.
- Required field mapping:
  - `fields.value.source_field`: source numeric metric field.
- Optional intent:
  - `fields.value.aggregation`: usually `avg` for score/rate, `sum` for bounded progress totals.
  - `filters`: use only when the user specified a real subset.

## Runtime Contract

- Runtime loads table schema, validates fields, generates scalar SQL/query output, renderer slots, bindings, and layout.
- Do not provide SQL, `QueryDef.output`, binding selectors, renderer slots, or option template.
- Keep values numeric; do not pre-format strings in SQL.

## Binding Guidance

- `stageChart` builds renderer slots and live bindings.
- Bind target, min, or max only after the builder contract explicitly supports those slots.

## Layout Defaults

- Desktop: `w: 4`, `h: 4`.
- Mobile: `w: 4`, `h: 4`.

## UX Notes

- Use a gauge only when the value is meaningfully bounded.
- If the metric is unbounded or trend-focused, prefer a KPI text card or line chart instead.
