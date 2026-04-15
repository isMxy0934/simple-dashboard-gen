import type { BindingRow, QueryOutput, ResultSchemaField } from "../../../contracts";

function mockValueForField(field: ResultSchemaField, rowIndex: number): BindingRow[string] {
  const seed = rowIndex + 1;
  switch (field.type) {
    case "number":
      return Math.round(1000 + seed * 137.42);
    case "boolean":
      return rowIndex % 2 === 0;
    case "date":
      return `2024-01-${String((seed % 28) + 1).padStart(2, "0")}`;
    case "datetime":
      return `2024-01-${String((seed % 28) + 1).padStart(2, "0")}T10:00:00Z`;
    case "string":
    default:
      return `mock_${field.name}_${seed}`;
  }
}

/**
 * Generate deterministic mock rows from a rows query output schema (no DB call).
 */
export function generateMockRowsFromQueryOutput(
  output: QueryOutput,
  rowCount = 6,
): BindingRow[] {
  if (output.kind !== "rows" || output.schema.length === 0) {
    return [];
  }

  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const row: BindingRow = {};
    for (const field of output.schema) {
      row[field.name] = mockValueForField(field, rowIndex);
    }
    return row;
  });
}
