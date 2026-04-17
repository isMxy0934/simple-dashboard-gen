function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CONTEXT_BLOCK_REGEX =
  /<!-- authoring-context:fp=[a-f0-9]+ -->[\s\S]*?(?=(?:\n## User Request\n)|$)/;

export function stripAuthoringContextBlock(text: string): string {
  return text.replace(CONTEXT_BLOCK_REGEX, "").replace(/^## User Request\n/, "").trim();
}

export function collectAuthoringTextParts(parts: unknown): string[] {
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts
    .filter(
      (part): part is { type: string; text: string } =>
        isRecord(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => stripAuthoringContextBlock(part.text))
    .filter(Boolean);
}

export function joinAuthoringTextParts(parts: unknown): string {
  return collectAuthoringTextParts(parts).join("\n").trim();
}
