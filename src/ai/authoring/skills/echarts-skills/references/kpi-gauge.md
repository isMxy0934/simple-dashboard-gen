# KPI Gauge

Use this reference for a single progress-like metric where a gauge communicates target attainment or bounded status.

```json skill-check
{
  "kind": "echarts-view",
  "supported_view_type": "kpi-gauge",
  "required_renderer_kind": "echarts",
  "series_type": "gauge",
  "option_keys": ["series"],
  "paired_data_formats": ["data-format-skills/scalar-kpi"],
  "requires_bounded_semantics": true,
  "required_slots": [
    { "role": "value", "value_kind": "scalar", "path_includes": "series" }
  ],
  "default_layout": {
    "desktop": { "w": 4, "h": 4 },
    "mobile": { "w": 4, "h": 4 }
  },
  "unsupported_message": "Gauge views are supported only for bounded progress, score, utilization, or target-attainment metrics."
}
```

## Best Fit

- Completion percentage
- Utilization or capacity ratio
- SLA attainment
- Score on a bounded scale

## Renderer Guidance

- Prefer a semicircle or compact circular gauge.
- Show one clear primary value.
- Avoid multiple needles or multi-series complexity for v1.
- Include min/max or target semantics only if they are real business constraints.

## Data Contract Guidance

- Prefer `output.kind = "scalar"` for one numeric value.
- Use one-row `rows` output only when the binding needs `rows[0].metric_name` via `result_selector`.
- If target context matters, include explicit min, max, or target fields instead of encoding them in text.
- Keep values numeric; do not pre-format strings in SQL.
- Pair this with `data-format-skills/scalar-kpi` for reusable query output and binding shape.

## Binding Guidance

- Bind the main metric to the gauge value slot.
- Bind title or subtitle separately if supported.
- If a target is supported by the renderer contract, bind it explicitly.

## UX Notes

- Use a gauge only when the value is meaningfully bounded.
- If the metric is unbounded or trend-focused, prefer a text card or line chart instead.
