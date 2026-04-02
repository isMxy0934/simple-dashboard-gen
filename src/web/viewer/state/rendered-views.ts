import type {
  BindingResult,
  BindingResults,
  DashboardView,
} from "@/contracts";
import { getViewSlots } from "@/domain/dashboard/contract-kernel";
import { estimateValueCount } from "@/renderers/core/slot-path";
import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import { injectBindingResultIntoEChartsOptionTemplate } from "@/renderers/echarts/browser/materialize-option";

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
    let optionTemplate = getViewOptionTemplateClone(view);
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

      optionTemplate = injectBindingResultIntoEChartsOptionTemplate(
        optionTemplate,
        slot,
        bindingEntry,
      );
      dataCount += Math.max(
        estimateValueCount(bindingEntry.data.value),
        0,
      );
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

function findBindingsForView(
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

function getViewOptionTemplateClone(view: DashboardView): EChartsOptionTemplate {
  return JSON.parse(JSON.stringify(view.renderer.option_template)) as EChartsOptionTemplate;
}
