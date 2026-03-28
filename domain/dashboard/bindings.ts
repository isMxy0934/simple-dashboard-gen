import type {
  Binding,
  BindingMode,
  BindingRow,
  DashboardView,
  JsonValue,
  QueryDef,
} from "../../contracts";
import { collectTemplateFields } from "../../contracts/validation";
import { cloneOptionTemplate, extractSeriesFieldNames } from "../rendering/dashboard-render";

export function createBindingForView(view: DashboardView, query: QueryDef): Binding {
  const templateFields = collectTemplateFields(view.option_template);
  const queryFields = query.result_schema.map((field) => field.name);

  const fieldMapping = Object.fromEntries(
    templateFields.map((fieldName, index) => [
      fieldName,
      queryFields[index] ?? queryFields[0] ?? fieldName,
    ]),
  );

  const paramMapping = Object.fromEntries(
    query.params.map((param) => [
      param.name,
      createDefaultParamMapping(param.name),
    ]),
  );

  return {
    id: `b_${view.id}`,
    view_id: view.id,
    mode: "live",
    query_id: query.id,
    param_mapping: paramMapping,
    field_mapping: fieldMapping,
  };
}

export function createMockBindingForView(view: DashboardView): Binding {
  const templateFields = collectTemplateFields(view.option_template);

  return {
    id: `b_${view.id}`,
    view_id: view.id,
    mode: "mock",
    mock_data: {
      rows: buildPreviewRows(templateFields) as BindingRow[],
    },
  };
}

export function getBindingMode(binding: Binding | undefined): BindingMode | "unbound" {
  if (!binding) {
    return "unbound";
  }

  return binding.mode ?? "live";
}

export function isLiveBinding(
  binding: Binding | undefined,
): binding is Binding & {
  mode?: "live";
  query_id: string;
  param_mapping: NonNullable<Binding["param_mapping"]>;
  field_mapping: NonNullable<Binding["field_mapping"]>;
} {
  return (
    getBindingMode(binding) === "live" &&
    typeof binding?.query_id === "string" &&
    !!binding.param_mapping &&
    !!binding.field_mapping
  );
}

export function isMockBinding(
  binding: Binding | undefined,
): binding is Binding & {
  mode?: "mock";
  mock_data: NonNullable<Binding["mock_data"]>;
} {
  return getBindingMode(binding) === "mock" && !!binding?.mock_data;
}

export function getTemplatePreviewOption(
  optionTemplate: DashboardView["option_template"],
): { option: DashboardView["option_template"]; rowsCount: number } {
  const option = cloneOptionTemplate(optionTemplate);
  const fields = extractSeriesFieldNames(optionTemplate);
  const rows = buildPreviewRows(fields);

  option.dataset = {
    ...(option.dataset ?? {}),
    source: rows,
  } as Record<string, JsonValue>;

  return {
    option,
    rowsCount: rows.length,
  };
}

function buildPreviewRows(fields: string[]): Array<Record<string, JsonValue>> {
  if (fields.length === 0) {
    return [];
  }

  return Array.from({ length: 5 }, (_, index) => {
    const row: Record<string, JsonValue> = {};

    for (const field of fields) {
      row[field] = createSampleValue(field, index);
    }

    return row;
  });
}

function createSampleValue(field: string, index: number): JsonValue {
  const normalized = field.toLowerCase();

  if (normalized.includes("week") || normalized.includes("date")) {
    return `2026-03-${String(3 + index * 3).padStart(2, "0")}`;
  }

  if (normalized.includes("region")) {
    return ["East", "West", "South", "North", "Central"][index % 5];
  }

  if (normalized.includes("channel")) {
    return ["Organic", "Paid", "Partner", "Referral", "Direct"][index % 5];
  }

  if (
    normalized.includes("label") ||
    normalized.includes("name") ||
    normalized.includes("type") ||
    normalized.includes("category")
  ) {
    return ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"][index % 5];
  }

  return 120 + index * 36;
}

function createDefaultParamMapping(paramName: string) {
  if (paramName === "start_date") {
    return { source: "filter" as const, value: "f_time_range.start" };
  }

  if (paramName === "end_date") {
    return { source: "filter" as const, value: "f_time_range.end" };
  }

  if (paramName === "timezone") {
    return { source: "runtime_context" as const, value: "timezone" };
  }

  if (paramName === "region") {
    return { source: "filter" as const, value: "f_region.value" };
  }

  return { source: "constant" as const, value: "" };
}
