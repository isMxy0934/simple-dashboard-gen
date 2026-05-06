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

## stageChart Guidance

- Use `stageChart` for creation or revision; do not handwrite `renderer.option_template`.
- Pass `skill_id: "echarts-kpi-text"`.
- Prefer a minimal renderer with one dominant value and one small supporting label.
- Avoid axes, legends, or dense decorative structure.
- Keep the card readable at small sizes.
- Required field mapping:
  - `fields.value.result_field`: scalar output value, or first-row metric field for rows output.

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

- `stageChart` builds renderer slots and live bindings.
- Scalar query output does not need a result selector.
- For one-row rows output, map `fields.value.result_field`.
- Prefer renderer formatting for currency, percent, or integer display.

## Layout Defaults

- Desktop: `w: 4`, `h: 3`.
- Mobile: `w: 4`, `h: 3`.

## UX Notes

- Title should state what the metric represents.
- Subtitle should explain period or scope if needed.
- If the value can be null, provide a safe fallback label rather than inventing data.
