import type {
  Binding,
  DashboardRenderer,
  DashboardRendererSlot,
  DashboardView,
  JsonObject,
  QueryDef,
  QueryOutput,
  QueryOutputKind,
  QueryParamType,
  ResultSchemaField,
} from "../../contracts";

export const DEFAULT_RENDERER_KIND = "echarts" as const;
export const DEFAULT_SLOT_ID = "main";
export const DEFAULT_SLOT_PATH = "dataset.source";
export const DEFAULT_SLOT_VALUE_KIND: QueryOutputKind = "rows";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getViewRenderer(view: DashboardView): DashboardRenderer {
  return {
    kind: view.renderer.kind,
    option_template: clone(view.renderer.option_template),
    slots: normalizeRendererSlots(view.renderer.slots),
  };
}

export function getViewOptionTemplate(view: DashboardView): JsonObject {
  return getViewRenderer(view).option_template;
}

export function getViewSlots(view: DashboardView): DashboardRendererSlot[] {
  return getViewRenderer(view).slots;
}

export function getViewSlotById(
  view: DashboardView,
  slotId: string,
): DashboardRendererSlot | undefined {
  return getViewSlots(view).find((slot) => slot.id === slotId);
}

export function getPrimarySlotId(view: DashboardView): string {
  return getViewSlots(view)[0]?.id ?? DEFAULT_SLOT_ID;
}

export function normalizeView(view: DashboardView): DashboardView {
  const renderer = getViewRenderer(view);

  return {
    ...view,
    renderer,
  };
}

export function getQueryOutput(query: QueryDef): QueryOutput {
  return clone(query.output);
}

export function getRowsOutputSchema(query: QueryDef): ResultSchemaField[] {
  const output = getQueryOutput(query);
  return output.kind === "rows" ? output.schema : [];
}

export function normalizeQuery(query: QueryDef): QueryDef {
  return {
    ...query,
    output: getQueryOutput(query),
  };
}

export function normalizeBinding(binding: Binding, view?: DashboardView): Binding {
  return {
    ...binding,
    slot_id: binding.slot_id,
    result_selector: binding.result_selector ?? null,
    mock_value:
      binding.mock_value ??
      (binding.mock_data ? binding.mock_data.rows : undefined),
  };
}

function normalizeRendererSlots(
  slots: DashboardRendererSlot[] | undefined,
): DashboardRendererSlot[] {
  return Array.isArray(slots) ? clone(slots) : [];
}

export function inferScalarValueType(value: unknown): QueryParamType {
  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "number") {
    return "number";
  }

  return "string";
}
