export type ProviderPayloadObservationKind =
  | "previous_response_id"
  | "item_reference";

export interface ProviderPayloadObservation {
  kind: ProviderPayloadObservationKind;
  path: string;
}

export interface ProviderPayloadSummary {
  provider: string;
  modelId: string;
  api: string;
  thinkingLevel: string;
  thinkingParam: string | null;
  enableThinking: boolean | null;
  reasoningEffort: string | null;
  inputCount: number | null;
  messageCount: number | null;
  toolCount: number | null;
  storeFalse: boolean | null;
  observations: ProviderPayloadObservation[];
}

const MAX_OBSERVATIONS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function pathForKey(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function summarizeThinkingParam(payload: Record<string, unknown>): string | null {
  const thinking = payload.thinking;
  if (typeof thinking === "string") {
    return thinking || null;
  }
  if (typeof thinking === "boolean") {
    return thinking ? "true" : "false";
  }
  if (isRecord(thinking)) {
    return stringOrNull(thinking.type);
  }
  return null;
}

function summarizeReasoningEffort(payload: Record<string, unknown>): string | null {
  const direct = stringOrNull(payload.reasoning_effort);
  if (direct) return direct;
  const reasoning = payload.reasoning;
  return isRecord(reasoning) ? stringOrNull(reasoning.effort) : null;
}

function collectObservations(
  value: unknown,
  path: string,
  observations: ProviderPayloadObservation[],
  key?: string,
): void {
  if (observations.length >= MAX_OBSERVATIONS) {
    return;
  }

  if (typeof value === "string") {
    if (key === "previous_response_id" && value.trim().length > 0) {
      observations.push({ kind: "previous_response_id", path });
      return;
    }
    if (value === "item_reference") {
      observations.push({ kind: "item_reference", path });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectObservations(value[index], `${path}[${index}]`, observations);
      if (observations.length >= MAX_OBSERVATIONS) {
        return;
      }
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [entryKey, entryValue] of Object.entries(value)) {
    collectObservations(
      entryValue,
      pathForKey(path, entryKey),
      observations,
      entryKey,
    );
    if (observations.length >= MAX_OBSERVATIONS) {
      return;
    }
  }
}

export function summarizeProviderPayload(input: {
  payload: unknown;
  provider: string;
  modelId: string;
  api: string;
  thinkingLevel: string;
}): ProviderPayloadSummary {
  const payload = isRecord(input.payload) ? input.payload : {};
  const observations: ProviderPayloadObservation[] = [];
  collectObservations(input.payload, "$", observations);

  return {
    provider: input.provider,
    modelId: input.modelId,
    api: input.api,
    thinkingLevel: input.thinkingLevel,
    thinkingParam: summarizeThinkingParam(payload),
    enableThinking: booleanOrNull(payload.enable_thinking),
    reasoningEffort: summarizeReasoningEffort(payload),
    inputCount: arrayLength(payload.input),
    messageCount: arrayLength(payload.messages),
    toolCount: arrayLength(payload.tools),
    storeFalse: typeof payload.store === "boolean" ? payload.store === false : null,
    observations,
  };
}
