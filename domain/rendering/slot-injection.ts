import type { BindingResult, EChartsOptionTemplate, JsonObject, JsonValue } from "../../contracts";

type PathSegment = string | number;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const matches = path.matchAll(/([^[.\]]+)|\[(\d+)\]/g);

  for (const match of matches) {
    if (match[1]) {
      segments.push(match[1]);
      continue;
    }

    if (match[2]) {
      segments.push(Number(match[2]));
    }
  }

  return segments;
}

export function setValueAtPath(target: JsonObject, path: string, value: JsonValue): void {
  const segments = parsePath(path);
  if (segments.length === 0) {
    return;
  }

  let current: JsonValue = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];

    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return;
      }

      while (current.length <= segment) {
        current.push(typeof nextSegment === "number" ? [] : {});
      }

      if (current[segment] === undefined || current[segment] === null) {
        current[segment] = typeof nextSegment === "number" ? [] : {};
      }

      current = current[segment] as JsonValue;
      continue;
    }

    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return;
    }

    const record = current as JsonObject;
    if (record[segment] === undefined || record[segment] === null) {
      record[segment] = typeof nextSegment === "number" ? [] : {};
    }

    current = record[segment] as JsonValue;
  }

  const finalSegment = segments[segments.length - 1];
  if (typeof finalSegment === "number") {
    if (!Array.isArray(current)) {
      return;
    }

    while (current.length <= finalSegment) {
      current.push(null);
    }
    current[finalSegment] = value;
    return;
  }

  if (typeof current !== "object" || current === null || Array.isArray(current)) {
    return;
  }

  (current as JsonObject)[finalSegment] = value;
}

export function injectValueIntoOptionTemplate(
  template: EChartsOptionTemplate,
  path: string,
  value: JsonValue,
): EChartsOptionTemplate {
  const option = clone(template) as EChartsOptionTemplate & JsonObject;
  setValueAtPath(option, path, value);
  return option;
}

export function getBindingResultValue(bindingResult: BindingResult | undefined): JsonValue | undefined {
  if (!bindingResult || bindingResult.status === "error") {
    return undefined;
  }

  return bindingResult.data.value;
}

export function getBindingResultRows(
  bindingResult: BindingResult | undefined,
): Array<Record<string, JsonValue>> {
  if (!bindingResult || bindingResult.status === "error") {
    return [];
  }

  if (Array.isArray(bindingResult.data.rows)) {
    return bindingResult.data.rows as Array<Record<string, JsonValue>>;
  }

  if (
    Array.isArray(bindingResult.data.value) &&
    bindingResult.data.value.every(
      (entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry),
    )
  ) {
    return bindingResult.data.value as Array<Record<string, JsonValue>>;
  }

  return [];
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
