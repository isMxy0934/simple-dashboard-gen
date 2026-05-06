---
name: echarts-kpi-gauge
description: Create or revise ECharts gauge KPI views for bounded progress, score, utilization, or target-attainment metrics. Use for gauge, meter, 仪表盘, 进度, 达成率.
triggers: [gauge, meter, progress, utilization, score, 仪表, 仪表盘, 进度, 达成率]
---

# ECharts KPI Gauge Skill

Use this skill for a single progress-like metric where a gauge communicates target attainment or bounded status.

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
  - `fields.value.result_field`: scalar output value, or first-row metric field for rows output.

## Query Output Contract

- Prefer `output.kind = "scalar"` for one numeric value.
- Use one-row `rows` output only when the binding needs to select a named field with `result_selector`.
- If target context matters, include explicit min, max, or target fields instead of encoding them in text.
- Keep values numeric; do not pre-format strings in SQL.

Scalar query shape:

```json
{
  "query": {
    "id": "q_gauge_value",
    "name": "Gauge Value",
    "datasource_id": "ds_example",
    "sql_template": "SELECT AVG(score) AS gauge_value FROM schema.table_name",
    "params": [],
    "output": {
      "kind": "scalar",
      "value_type": "number"
    }
  }
}
```

## Binding Guidance

- `stageChart` builds renderer slots and live bindings.
- Scalar query output does not need a result selector.
- For one-row rows output, map `fields.value.result_field`.
- Bind target, min, or max only after the builder contract explicitly supports those slots.

## Layout Defaults

- Desktop: `w: 4`, `h: 4`.
- Mobile: `w: 4`, `h: 4`.

## UX Notes

- Use a gauge only when the value is meaningfully bounded.
- If the metric is unbounded or trend-focused, prefer a KPI text card or line chart instead.
