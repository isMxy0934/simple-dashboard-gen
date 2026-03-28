import type { BindingResult, EChartsOptionTemplate, JsonValue } from "../../contracts";

type Row = Record<string, string | number | boolean | null>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeRows(bindingResult: BindingResult): Row[] {
  if (bindingResult.status === "error") {
    return [];
  }

  return bindingResult.data.rows as Row[];
}

export function injectRowsIntoOptionTemplate(
  template: EChartsOptionTemplate,
  bindingResult: BindingResult | undefined,
): EChartsOptionTemplate {
  const option = clone(template);
  const rows = bindingResult ? normalizeRows(bindingResult) : [];

  option.dataset = {
    ...(option.dataset ?? {}),
    source: rows,
  } as Record<string, JsonValue>;

  return option;
}

export function isOptionTemplateEmpty(bindingResult: BindingResult | undefined): boolean {
  if (!bindingResult) {
    return true;
  }

  return bindingResult.status !== "error" && bindingResult.data.rows.length === 0;
}
