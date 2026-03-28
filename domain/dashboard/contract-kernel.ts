import type {
  Binding,
  DashboardRenderer,
  DashboardRendererSlot,
  DashboardView,
  EChartsOptionTemplate,
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
  const optionTemplate = clone(view.renderer?.option_template ?? view.option_template ?? { series: [] });
  const slots = normalizeRendererSlots(view.renderer?.slots);

  return {
    kind: DEFAULT_RENDERER_KIND,
    option_template: optionTemplate,
    slots,
  };
}

export function getViewOptionTemplate(view: DashboardView): EChartsOptionTemplate {
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
    option_template: renderer.option_template,
  };
}

export function getQueryOutput(query: QueryDef): QueryOutput {
  if (query.output) {
    return clone(query.output);
  }

  return {
    kind: "rows",
    schema: clone(query.result_schema ?? []),
  };
}

export function getRowsOutputSchema(query: QueryDef): ResultSchemaField[] {
  const output = getQueryOutput(query);
  return output.kind === "rows" ? output.schema : [];
}

export function normalizeQuery(query: QueryDef): QueryDef {
  const output = getQueryOutput(query);

  return {
    ...query,
    output,
    result_schema: output.kind === "rows" ? output.schema : [],
  };
}

export function normalizeBinding(binding: Binding, view?: DashboardView): Binding {
  const slotId = binding.slot_id ?? (view ? getPrimarySlotId(view) : DEFAULT_SLOT_ID);

  return {
    ...binding,
    slot_id: slotId,
    result_selector: binding.result_selector ?? null,
    mock_value:
      binding.mock_value ??
      (binding.mock_data ? binding.mock_data.rows : undefined),
  };
}

function normalizeRendererSlots(
  slots: DashboardRendererSlot[] | undefined,
): DashboardRendererSlot[] {
  if (Array.isArray(slots) && slots.length > 0) {
    return slots.map((slot) => ({
      ...slot,
      id: slot.id || DEFAULT_SLOT_ID,
      path: slot.path || DEFAULT_SLOT_PATH,
      value_kind: slot.value_kind || DEFAULT_SLOT_VALUE_KIND,
    }));
  }

  return [
    {
      id: DEFAULT_SLOT_ID,
      path: DEFAULT_SLOT_PATH,
      value_kind: DEFAULT_SLOT_VALUE_KIND,
      required: true,
    },
  ];
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
