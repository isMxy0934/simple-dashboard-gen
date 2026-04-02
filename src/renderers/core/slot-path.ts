import type { BindingResult, JsonObject, JsonValue } from "@/contracts";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface PathToken {
  key: string;
  index?: number;
}

function parseSlotPath(path: string): PathToken[] {
  return path.split(".").flatMap((segment) => {
    const match = segment.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?:\[(\d+)\])?$/);
    if (!match) {
      throw new Error(`Unsupported slot path segment "${segment}" in "${path}".`);
    }

    return {
      key: match[1],
      index: match[2] === undefined ? undefined : Number(match[2]),
    };
  });
}

export function setValueAtSlotPath(
  target: JsonObject,
  path: string,
  value: JsonValue,
): JsonObject {
  const tokens = parseSlotPath(path);
  const root = clone(target);
  let current: Record<string, unknown> | unknown[] = root;

  tokens.forEach((token, index) => {
    if (!isRecord(current)) {
      throw new Error(`Slot path "${path}" cannot be written.`);
    }

    const isLeaf = index === tokens.length - 1;
    const currentValue = current[token.key];

    if (token.index === undefined) {
      if (isLeaf) {
        current[token.key] = value;
        return;
      }

      if (!isRecord(currentValue)) {
        current[token.key] = {};
      }
      current = current[token.key] as Record<string, unknown>;
      return;
    }

    if (!Array.isArray(currentValue)) {
      current[token.key] = [];
    }

    const list = current[token.key] as unknown[];
    while (list.length <= token.index) {
      list.push({});
    }

    if (isLeaf) {
      list[token.index] = value;
      return;
    }

    if (!isRecord(list[token.index])) {
      list[token.index] = {};
    }
    current = list[token.index] as Record<string, unknown>;
  });

  return root;
}

export function injectValueIntoTemplate(
  template: JsonObject,
  path: string,
  value: JsonValue,
): JsonObject {
  return setValueAtSlotPath(template, path, value);
}

export function getBindingResultValue(
  bindingResult: BindingResult | undefined,
): JsonValue | undefined {
  if (!bindingResult || bindingResult.status === "error") {
    return undefined;
  }

  return bindingResult.data.value;
}

export function getBindingResultRows(bindingResult: BindingResult | undefined) {
  if (!bindingResult || bindingResult.status === "error") {
    return [];
  }

  return bindingResult.data.rows ?? [];
}

export function estimateValueCount(value: JsonValue | undefined): number {
  if (value === undefined || value === null) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  return 1;
}
