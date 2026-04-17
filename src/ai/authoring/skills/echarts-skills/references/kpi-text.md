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

## Data Contract Guidance

- Prefer one row with explicit metric fields.
- Keep the primary metric numeric.
- If a comparison is needed, return a separate numeric field for the previous value or delta basis.

## Binding Guidance

- Bind the main numeric field to the primary display slot.
- Bind label or subtitle fields separately.
- Prefer renderer formatting for currency, percent, or integer display.

## UX Notes

- Title should state what the metric represents.
- Subtitle should explain period or scope if needed.
- If the value can be null, provide a safe fallback label rather than inventing data.
