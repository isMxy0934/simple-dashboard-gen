# KPI Gauge

Use this reference for a single progress-like metric where a gauge communicates target attainment or bounded status.

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

- Prefer one row with one numeric value.
- If target context matters, include explicit min, max, or target fields instead of encoding them in text.
- Keep values numeric; do not pre-format strings in SQL.

## Binding Guidance

- Bind the main metric to the gauge value slot.
- Bind title or subtitle separately if supported.
- If a target is supported by the renderer contract, bind it explicitly.

## UX Notes

- Use a gauge only when the value is meaningfully bounded.
- If the metric is unbounded or trend-focused, prefer a text card or line chart instead.
