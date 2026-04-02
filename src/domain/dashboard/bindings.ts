import type {
  Binding,
  BindingMode,
  BindingRow,
  DashboardView,
  JsonValue,
  MockBindingData,
  QueryDef,
  QueryOutputKind,
} from "../../contracts";
import {
  getPrimarySlotId,
  getQueryOutput,
  getRowsOutputSchema,
  getViewSlots,
} from "./contract-kernel";

export function createBindingForView(view: DashboardView, query: QueryDef): Binding {
  const primarySlot = getViewSlots(view)[0];
  const paramMapping = Object.fromEntries(
    query.params.map((param) => [
      param.name,
      createDefaultParamMapping(param.name),
    ]),
  );

  return {
    id: `b_${view.id}`,
    view_id: view.id,
    slot_id: primarySlot?.id ?? getPrimarySlotId(view),
    mode: "live",
    query_id: query.id,
    param_mapping: paramMapping,
    result_selector: createDefaultResultSelector(query, primarySlot?.value_kind),
  };
}

export function createMockBindingForView(view: DashboardView): Binding {
  const primarySlot = getViewSlots(view)[0];
  const previewRows = buildPreviewRows();
  const previewData: MockBindingData = {
    rows: previewRows,
  };

  return {
    id: `b_${view.id}`,
    view_id: view.id,
    slot_id: primarySlot?.id ?? getPrimarySlotId(view),
    mode: "mock",
    mock_data: previewData,
    mock_value: createMockValueForSlot(primarySlot?.value_kind, previewRows),
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
  slot_id: string;
  param_mapping: NonNullable<Binding["param_mapping"]>;
} {
  return (
    getBindingMode(binding) === "live" &&
    typeof binding?.slot_id === "string" &&
    typeof binding?.query_id === "string" &&
    !!binding.param_mapping
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

export function reconcileBindingShape(
  binding: Binding,
  view: DashboardView,
  query: QueryDef,
): Binding {
  const nextBinding = createBindingForView(view, query);
  if (!isLiveBinding(binding)) {
    return nextBinding;
  }

  const nextParamMapping =
    nextBinding.param_mapping as NonNullable<Binding["param_mapping"]>;

  for (const param of query.params) {
    if (binding.param_mapping[param.name]) {
      nextParamMapping[param.name] = binding.param_mapping[param.name];
    }
  }

  return {
    ...binding,
    id: binding.id,
    view_id: view.id,
    slot_id: getPrimarySlotId(view),
    mode: "live",
    query_id: query.id,
    param_mapping: nextParamMapping,
    result_selector:
      getQueryOutput(query).kind === "rows"
        ? binding.result_selector ?? nextBinding.result_selector
        : nextBinding.result_selector,
    mock_data: undefined,
    mock_value: undefined,
  };
}

function createDefaultResultSelector(
  query: QueryDef,
  slotValueKind: QueryOutputKind | undefined,
) {
  if (!slotValueKind) {
    return null;
  }

  const output = getQueryOutput(query);
  if (output.kind === slotValueKind) {
    return null;
  }

  if (output.kind !== "rows") {
    return null;
  }

  if (slotValueKind === "object") {
    return "rows[0]";
  }

  const firstField = getRowsOutputSchema(query)[0]?.name;
  if (!firstField) {
    return null;
  }

  if (slotValueKind === "scalar") {
    return `rows[0].${firstField}`;
  }

  if (slotValueKind === "array") {
    return `rows[].${firstField}`;
  }

  return null;
}

function createMockValueForSlot(
  slotValueKind: DashboardView["renderer"]["slots"][number]["value_kind"] | undefined,
  rows: BindingRow[],
): JsonValue {
  if (slotValueKind === "scalar") {
    return rows[0]?.value ?? 156;
  }

  if (slotValueKind === "object") {
    return (rows[0] ?? null) as JsonValue;
  }

  if (slotValueKind === "array") {
    return rows.map((row) => row.value ?? null);
  }

  return rows;
}

function buildPreviewRows(): BindingRow[] {
  return Array.from({ length: 5 }, (_, index) => ({
    label: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"][index],
    value: 120 + index * 36,
    date: `2026-03-${String(3 + index * 3).padStart(2, "0")}`,
  }));
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
