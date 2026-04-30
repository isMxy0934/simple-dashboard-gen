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

## Renderer Guidance

- `renderer.kind` must be `echarts`.
- Prefer a semicircle or compact circular gauge.
- Show one clear primary value.
- Avoid multiple needles or multi-series complexity for the first draft.
- Include min/max or target semantics only if they are real business constraints.
- Required slots:
  - `value`: scalar value under a gauge series path.

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

- Bind the main metric to the gauge value slot.
- If scalar output is used, omit `result_selector` or set it to `null`.
- If one-row rows output is used, use a selector such as `rows[0].gauge_value`.
- Bind title, target, min, or max separately only if the renderer contract includes those slots.
- Always include `param_mapping`; use `{}` when there are no params.

## Layout Defaults

- Desktop: `w: 4`, `h: 4`.
- Mobile: `w: 4`, `h: 4`.

## UX Notes

- Use a gauge only when the value is meaningfully bounded.
- If the metric is unbounded or trend-focused, prefer a KPI text card or line chart instead.
