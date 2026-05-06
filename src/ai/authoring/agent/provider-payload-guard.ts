const PROVIDER_RUNTIME_KEYS = new Set([
  "providerOptions",
  "providerMetadata",
  "callProviderMetadata",
  "resultProviderMetadata",
]);

const OPENAI_RUNTIME_ITEM_ID_PATTERN = /\b(?:rs|msg|fc)_[A-Za-z0-9_-]+\b/;
const OPENAI_RUNTIME_ITEM_ID_KEYS = new Set([
  "id",
  "itemId",
  "item_id",
  "previous_response_id",
  "call_id",
]);

export interface ProviderPayloadBoundaryInspection {
  safe: boolean;
  reason: string | null;
  path: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inspectProviderPayloadValue(
  value: unknown,
  path: string,
  key?: string,
): ProviderPayloadBoundaryInspection {
  if (typeof value === "string") {
    if (value === "item_reference") {
      return {
        safe: false,
        reason: "OpenAI item_reference leaked into provider payload.",
        path,
      };
    }
    if (
      key &&
      OPENAI_RUNTIME_ITEM_ID_KEYS.has(key) &&
      OPENAI_RUNTIME_ITEM_ID_PATTERN.test(value)
    ) {
      return {
        safe: false,
        reason: "OpenAI runtime item id leaked into provider payload.",
        path,
      };
    }
    return { safe: true, reason: null, path: null };
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = inspectProviderPayloadValue(value[index], `${path}[${index}]`);
      if (!result.safe) {
        return result;
      }
    }
    return { safe: true, reason: null, path: null };
  }

  if (!isRecord(value)) {
    return { safe: true, reason: null, path: null };
  }

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = path ? `${path}.${key}` : key;
    if (PROVIDER_RUNTIME_KEYS.has(key)) {
      return {
        safe: false,
        reason: `Provider runtime metadata key "${key}" leaked into provider payload.`,
        path: entryPath,
      };
    }
    const result = inspectProviderPayloadValue(entry, entryPath, key);
    if (!result.safe) {
      return result;
    }
  }

  return { safe: true, reason: null, path: null };
}

export function inspectProviderPayloadBoundary(
  payload: unknown,
): ProviderPayloadBoundaryInspection {
  return inspectProviderPayloadValue(payload, "$");
}

export function assertProviderPayloadBoundary(payload: unknown): void {
  const inspection = inspectProviderPayloadBoundary(payload);
  if (!inspection.safe) {
    throw new Error(
      `Provider payload boundary violation: ${inspection.reason} (${inspection.path ?? "$"})`,
    );
  }
}
