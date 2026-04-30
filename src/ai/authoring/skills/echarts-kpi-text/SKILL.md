---
name: echarts-kpi-text
description: Create or revise ECharts KPI text cards for one headline metric. Use for KPI, metric cards, scorecards, 指标, 指标卡, 卡片, total/average/rate summary values.
triggers: [kpi, metric-card, scorecard, 指标, 指标卡, 卡片]
---

# ECharts KPI Text Skill

Use this skill for a single headline metric shown as a text-first ECharts view.

## Best Fit

- One primary number.
- Optional short label.
- Optional delta or comparison note.
- Dashboard hero metric, summary card, or compact status tile.

## Renderer Guidance

- `renderer.kind` must be `echarts`; do not use `kpi-text` as a renderer kind.
- Prefer a minimal renderer with one dominant value and one small supporting label.
- Avoid axes, legends, or dense decorative structure.
- Keep the card readable at small sizes.
- Always include a non-empty `option_template`, and make every slot path point to an existing node.
- Required slots:
  - `value`: scalar value under a graphic text path.

Canonical KPI view shape:

```json
{
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
  }
}
```

## Query Output Contract

- Prefer `output.kind = "scalar"` when the view needs only one value.
- Use one-row `rows` output only when the binding needs to select a named field with `result_selector`.
- Keep the primary metric numeric; do not pre-format currency, percent, or units in SQL.
- If a comparison is needed, return a separate numeric field for the previous value or delta basis.

Scalar query shape:

```json
{
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

## Binding Guidance

- Bind scalar output directly to the primary value slot.
- For scalar output, omit `result_selector` or set it to `null`.
- For one-row rows output, use a selector such as `rows[0].metric_value`.
- Always include `param_mapping`; use `{}` when there are no params.
- Prefer renderer formatting for currency, percent, or integer display.

## Layout Defaults

- Desktop: `w: 4`, `h: 3`.
- Mobile: `w: 4`, `h: 3`.

## UX Notes

- Title should state what the metric represents.
- Subtitle should explain period or scope if needed.
- If the value can be null, provide a safe fallback label rather than inventing data.
