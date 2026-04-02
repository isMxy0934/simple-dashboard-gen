import {
  setValueAtRendererSlotPath,
  type BindingResult,
  type JsonObject,
  type JsonValue,
} from "@/contracts";

export function setValueAtSlotPath(
  target: JsonObject,
  path: string,
  value: JsonValue,
): JsonObject {
  return setValueAtRendererSlotPath(target, path, value);
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
