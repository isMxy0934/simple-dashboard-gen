export function normalizeSchemaAllowlist(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const seen = new Set<string>();
  const schemas: string[] = [];

  for (const entry of raw) {
    const schema = typeof entry === "string" ? entry.trim() : "";
    if (!schema || seen.has(schema)) {
      continue;
    }
    seen.add(schema);
    schemas.push(schema);
  }

  return schemas.length > 0 ? schemas : undefined;
}
