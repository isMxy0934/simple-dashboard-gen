import type { JsonObject, JsonValue } from "./dashboard";

export interface SlotPathToken {
  key: string;
  index?: number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function parseRendererSlotPath(path: string): SlotPathToken[] {
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

export function hasRendererSlotPath(target: JsonObject, path: string): boolean {
  try {
    let current: unknown = target;

    for (const token of parseRendererSlotPath(path)) {
      if (!isRecord(current) || !hasOwn(current, token.key)) {
        return false;
      }

      const next = current[token.key];
      if (token.index === undefined) {
        current = next;
        continue;
      }

      if (!Array.isArray(next) || token.index >= next.length) {
        return false;
      }

      current = next[token.index];
    }

    return true;
  } catch {
    return false;
  }
}

export function setValueAtRendererSlotPath(
  target: JsonObject,
  path: string,
  value: JsonValue,
): JsonObject {
  const tokens = parseRendererSlotPath(path);
  const root = clone(target);
  let current: Record<string, unknown> | unknown[] = root;

  tokens.forEach((token, index) => {
    if (!isRecord(current) || !hasOwn(current, token.key)) {
      throw new Error(`Slot path "${path}" must point to an existing template node.`);
    }

    const isLeaf = index === tokens.length - 1;
    const currentValue = current[token.key];

    if (token.index === undefined) {
      if (isLeaf) {
        current[token.key] = value;
        return;
      }

      if (!isRecord(currentValue)) {
        throw new Error(`Slot path "${path}" must point to an existing template node.`);
      }

      current = currentValue;
      return;
    }

    if (!Array.isArray(currentValue) || token.index >= currentValue.length) {
      throw new Error(`Slot path "${path}" must point to an existing template node.`);
    }

    if (isLeaf) {
      currentValue[token.index] = value;
      return;
    }

    if (!isRecord(currentValue[token.index])) {
      throw new Error(`Slot path "${path}" must point to an existing template node.`);
    }

    current = currentValue[token.index] as Record<string, unknown>;
  });

  return root;
}
