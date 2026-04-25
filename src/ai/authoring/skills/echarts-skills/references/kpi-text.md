# KPI Text Card

Use this reference for a single headline metric shown as a text-first ECharts view.

## Best Fit

- One primary number
- Optional short label
- Optional delta or comparison note
- Dashboard hero metric, summary card, or compact status tile

## Renderer Guidance

- Prefer a minimal renderer with one dominant value and one small supporting label.
- Avoid axes, legends, or dense decorative structure.
- Keep the card readable at small sizes.
- `renderer.kind` must always be `echarts`; do not use `kpi-text` as a renderer kind.
- Always include a non-empty `option_template`, and make every slot path point to an existing node.

Canonical KPI view:

```json
{
  "request": "Create a KPI text card.",
  "view_spec": {
    "view_id": "v_total_orders",
    "title": "Total Orders",
    "description": "All-time order volume",
    "renderer": {
      "kind": "echarts",
      "option_template": {
        "graphic": [
          {
            "type": "text",
            "left": "center",
            "top": "middle",
            "style": {
              "text": "0",
              "fontSize": 36,
              "fontWeight": 700,
              "fill": "#111827",
              "textAlign": "center"
            }
          }
        ]
      },
      "slots": [
        {
          "id": "value",
          "path": "graphic[0].style.text",
          "value_kind": "scalar",
          "required": true,
          "formatter": "integer"
        }
      ]
    }
  },
  "layout": {
    "desktop": { "view_id": "v_total_orders", "x": 0, "y": 0, "w": 4, "h": 3 },
    "mobile": { "view_id": "v_total_orders", "x": 0, "y": 0, "w": 4, "h": 3 }
  }
}
```

## Data Contract Guidance

- Prefer a scalar output for one headline number when the renderer slot expects a scalar.
- Use one-row `rows` output only when the binding needs `rows[0].metric_name` via `result_selector`.
- Keep the primary metric numeric.
- If a comparison is needed, return a separate numeric field for the previous value or delta basis.

Canonical scalar query:

```json
{
  "reason": "Create the primary KPI value.",
  "query": {
    "id": "q_total_orders",
    "name": "Total Orders",
    "datasource_id": "ds_example",
    "sql_template": "SELECT SUM(orders) AS total_orders FROM public.sales_weekly_fact",
    "params": [],
    "output": {
      "kind": "scalar",
      "value_type": "number"
    }
  }
}
```

Canonical one-row query:

```json
{
  "reason": "Create a KPI value that will be selected from the first row.",
  "query": {
    "id": "q_total_orders",
    "name": "Total Orders",
    "datasource_id": "ds_example",
    "sql_template": "SELECT SUM(orders) AS total_orders FROM public.sales_weekly_fact",
    "params": [],
    "output": {
      "kind": "rows",
      "schema": [
        { "name": "total_orders", "type": "number", "nullable": false }
      ]
    }
  }
}
```

## Binding Guidance

- Bind the main numeric field to the primary display slot.
- Bind label or subtitle fields separately.
- Live bindings must include `param_mapping`; use `{}` for paramless KPI queries.
- If the query output is `scalar`, omit `result_selector` or set it to `null`.
- If the query uses one-row rows output for a scalar slot, set `result_selector` to `rows[0].total_orders`.
- Prefer renderer formatting for currency, percent, or integer display.

Canonical scalar binding:

```json
{
  "reason": "Bind the scalar KPI value.",
  "binding": {
    "id": "b_total_orders",
    "view_id": "v_total_orders",
    "slot_id": "value",
    "mode": "live",
    "query_id": "q_total_orders",
    "param_mapping": {},
    "result_selector": null
  }
}
```

## UX Notes

- Title should state what the metric represents.
- Subtitle should explain period or scope if needed.
- If the value can be null, provide a safe fallback label rather than inventing data.
