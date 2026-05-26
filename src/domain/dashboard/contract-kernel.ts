import type {
  Binding,
  DashboardRenderer,
  DashboardRendererSlot,
  DashboardView,
  JsonObject,
  JsonValue,
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
  const renderer = {
    kind: view.renderer.kind,
    recipe_id: view.renderer.recipe_id,
    option_template: clone(view.renderer.option_template),
    slots: normalizeRendererSlots(view.renderer.slots),
    ...(view.renderer.transforms
      ? { transforms: clone(view.renderer.transforms) }
      : {}),
  };

  return normalizeRendererForViewShell(renderer, view);
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

export function normalizeBinding(binding: Binding, _view?: DashboardView): Binding {
  return {
    ...binding,
    slot_id: binding.slot_id,
    result_selector: binding.result_selector ?? null,
    mock_value: binding.mock_value,
  };
}

function normalizeRendererSlots(
  slots: DashboardRendererSlot[] | undefined,
): DashboardRendererSlot[] {
  return Array.isArray(slots) ? clone(slots) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getGraphicText(element: unknown): unknown {
  if (!isRecord(element) || !isRecord(element.style)) {
    return undefined;
  }

  return element.style.text;
}

function isKpiStatusBadgeText(value: unknown): boolean {
  return isRecord(value) && value.$i18n === "kpiCard.badgeLive";
}

function isKpiStatusBadgeRect(element: unknown): boolean {
  if (!isRecord(element) || element.type !== "rect" || !isRecord(element.shape)) {
    return false;
  }

  return (
    element.right !== undefined &&
    element.top !== undefined &&
    typeof element.shape.width === "number" &&
    element.shape.width <= 80 &&
    typeof element.shape.height === "number" &&
    element.shape.height <= 32
  );
}

function normalizeKpiSlotPath(
  path: string,
  graphicIndexMap: Map<number, number>,
): string {
  const match = /^graphic\[(\d+)](.*)$/.exec(path);
  if (!match) {
    return path;
  }

  const nextIndex = graphicIndexMap.get(Number(match[1]));
  return nextIndex === undefined ? path : `graphic[${nextIndex}]${match[2]}`;
}

function normalizeRendererForViewShell(
  renderer: DashboardRenderer,
  view: DashboardView,
): DashboardRenderer {
  if (renderer.recipe_id !== "echarts-kpi-card") {
    return renderer;
  }

  const graphic = renderer.option_template.graphic;
  if (!Array.isArray(graphic)) {
    return renderer;
  }

  const indexesToRemove = new Set<number>();
  graphic.forEach((element, index) => {
    const text = getGraphicText(element);
    if (
      text === view.title ||
      (view.description !== undefined && text === view.description) ||
      isKpiStatusBadgeText(text)
    ) {
      indexesToRemove.add(index);
    }

    if (isKpiStatusBadgeText(text) && isKpiStatusBadgeRect(graphic[index - 1])) {
      indexesToRemove.add(index - 1);
    }
  });

  if (indexesToRemove.size === 0) {
    return renderer;
  }

  const graphicIndexMap = new Map<number, number>();
  const nextGraphic: JsonValue[] = [];
  graphic.forEach((element, index) => {
    if (indexesToRemove.has(index)) {
      return;
    }
    graphicIndexMap.set(index, nextGraphic.length);
    nextGraphic.push(element);
  });

  return {
    ...renderer,
    option_template: {
      ...renderer.option_template,
      graphic: nextGraphic,
    },
    slots: renderer.slots.map((slot) => ({
      ...slot,
      path: normalizeKpiSlotPath(slot.path, graphicIndexMap),
    })),
  };
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
