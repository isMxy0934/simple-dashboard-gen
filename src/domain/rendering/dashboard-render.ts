import type {
  BindingResult,
  BindingResults,
  DashboardRendererSlot,
  DashboardView,
  EChartsOptionTemplate,
} from "../../contracts";
import { getViewOptionTemplate, getViewSlots } from "../dashboard/contract-kernel";
import { getBindingResultRows, injectValueIntoOptionTemplate } from "./slot-injection";

export type ViewRenderStatus = "loading" | "ok" | "empty" | "error";

export interface RenderedView {
  view: DashboardView;
  bindingIds: string[];
  status: ViewRenderStatus;
  message?: string;
  optionTemplate: EChartsOptionTemplate;
  dataCount: number;
}

export function deriveRenderedViews(
  views: DashboardView[],
  bindings: BindingResults,
  statusMap: Record<string, ViewRenderStatus>,
): RenderedView[] {
  return views.map((view) => {
    const bindingEntries = findBindingsForView(bindings, view.id);
    let optionTemplate = cloneOptionTemplate(getViewOptionTemplate(view));
    let dataCount = 0;
    const slotById = new Map(getViewSlots(view).map((slot) => [slot.id, slot]));

    bindingEntries.forEach((bindingEntry) => {
      if (bindingEntry.status === "error") {
        return;
      }

      const slot = slotById.get(bindingEntry.slot_id);
      if (!slot) {
        return;
      }

      optionTemplate = injectResultIntoTemplate(optionTemplate, slot, bindingEntry);
      dataCount += Math.max(getBindingResultRows(bindingEntry).length, 0);
    });

    return {
      view,
      bindingIds: bindingEntries.map((entry) => entry.bindingId),
      status: statusMap[view.id] ?? "loading",
      message:
        bindingEntries.find((entry) => entry.status === "error")?.message ??
        bindingEntries.find((entry) => entry.status === "error")?.code ??
        (bindingEntries.length > 0 &&
        bindingEntries.every((entry) => entry.status === "empty")
          ? "No rows were returned for this filter."
          : undefined),
      optionTemplate,
      dataCount,
    };
  });
}

export function findBindingsForView(
  bindings: BindingResults,
  viewId: string,
): Array<BindingResult & { bindingId: string }> {
  const matches: Array<BindingResult & { bindingId: string }> = [];
  for (const [bindingId, result] of Object.entries(bindings)) {
    if (result.view_id === viewId) {
      matches.push({
        ...result,
        bindingId,
      } as BindingResult & { bindingId: string });
    }
  }

  return matches;
}

export function cloneOptionTemplate<T extends EChartsOptionTemplate>(template: T): T {
  return JSON.parse(JSON.stringify(template)) as T;
}

export function extractSeriesFieldNames(optionTemplate: EChartsOptionTemplate): string[] {
  const fields = new Set<string>();
  (optionTemplate.series ?? []).forEach((series) => {
    if (!series.encode) {
      return;
    }

    Object.values(series.encode).forEach((value) => {
      if (typeof value === "string") {
        fields.add(value);
        return;
      }
      value.forEach((field) => fields.add(field));
    });
  });
  return [...fields];
}

function injectResultIntoTemplate(
  template: EChartsOptionTemplate,
  slot: DashboardRendererSlot,
  bindingResult: BindingResult,
): EChartsOptionTemplate {
  if (bindingResult.status === "error") {
    return template;
  }

  return injectValueIntoOptionTemplate(template, slot.path, bindingResult.data.value);
}
