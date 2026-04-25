# Scalar KPI

Use this reference for one headline metric shown as a KPI card or compact summary view.

## Best Fit

- Total, average, rate, score, or current status shown as one primary number.
- A small group of independent KPIs where each card owns one metric.
- Metrics that do not need a time axis or category breakdown in the first draft.

## Query Output Contract

- Prefer `output.kind = "scalar"` when the view needs only one value.
- Use one-row `rows` only when the binding needs to select a named field with `result_selector`.
- Keep the returned value numeric; do not pre-format currency, percent, or units in SQL.
- If the denominator can be zero, return `0` only when the business meaning is clear; otherwise return `NULL` and let the view show a safe empty state.

Scalar query shape:

```json
{
  "reason": "Create the KPI value.",
  "query": {
    "id": "q_metric_value",
    "name": "Metric Value",
    "datasource_id": "ds_example",
    "sql_template": "SELECT SUM(metric) AS metric_value FROM schema.table_name",
    "params": [],
    "output": {
      "kind": "scalar",
      "value_type": "number"
    }
  }
}
```

## Binding Contract

- Bind the scalar output directly to the primary value slot.
- For scalar output, omit `result_selector` or set it to `null`.
- Always include `param_mapping`; use `{}` when there are no params.

```json
{
  "reason": "Bind KPI value.",
  "binding": {
    "id": "b_metric_value",
    "view_id": "v_metric_value",
    "slot_id": "value",
    "mode": "live",
    "query_id": "q_metric_value",
    "param_mapping": {},
    "result_selector": null
  }
}
```

## Defaults

- Counts: integer formatting.
- Currency, average price, and ratios shown as numeric values: two decimals unless the user specifies otherwise.
- Percent rates: percent formatting when the metric is semantically a rate.
- Layout: KPI cards can be compact. Multiple KPI cards should usually align in one row on desktop and stack on mobile.
