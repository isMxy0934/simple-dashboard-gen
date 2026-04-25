import { getWriteToolContract } from "@/ai/authoring/tool-contracts";

export function buildRepairToolPrompt(input: {
  toolName: "upsertQuery" | "upsertView" | "upsertBinding";
  validationError: string;
  jsonSchema: unknown;
  invalidInput: unknown;
}): string {
  const contract = getWriteToolContract(input.toolName);
  return [
    `Repair this ${input.toolName} tool input by regenerating canonical args only.`,
    contract ? `Tool contract: ${contract}` : null,
    "Return only args that satisfy the JSON schema. Do not explain.",
    "Validation error:",
    input.validationError,
    "Strict JSON schema:",
    JSON.stringify(input.jsonSchema),
    "Invalid input:",
    typeof input.invalidInput === "string"
      ? input.invalidInput
      : JSON.stringify(input.invalidInput),
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}
