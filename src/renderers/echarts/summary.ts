import type { DashboardRenderer, DashboardRendererSlot, DashboardView } from "@/contracts";
import type { RendererSlotSummary, RendererSummary } from "@/renderers/core/contracts";
import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import { getEChartsSeries } from "@/renderers/echarts/contract";

function buildRendererSlotSummary(slot: DashboardRendererSlot): RendererSlotSummary {
  return {
    id: slot.id,
    path: slot.path,
    value_kind: slot.value_kind,
    required: slot.required !== false,
  };
}

export function collectEChartsTemplateFields(
  optionTemplate: EChartsOptionTemplate,
): string[] {
  const fields = new Set<string>();

  getEChartsSeries(optionTemplate).forEach((series) => {
    if (!series.encode || typeof series.encode !== "object") {
      return;
    }

    Object.values(series.encode).forEach((value) => {
      if (typeof value === "string" && value.length > 0) {
        fields.add(value);
        return;
      }

      if (Array.isArray(value)) {
        value
          .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
          .forEach((entry) => fields.add(entry));
      }
    });
  });

  return [...fields];
}

export function collectEChartsTemplateFieldsFromView(view: DashboardView): string[] {
  return collectEChartsTemplateFields(view.renderer.option_template);
}

export function summarizeEChartsRenderer(renderer: DashboardRenderer): RendererSummary {
  return {
    kind: renderer.kind,
    option_keys: Object.keys(renderer.option_template ?? {}).sort(),
    option_template_is_empty: Object.keys(renderer.option_template ?? {}).length === 0,
    slot_count: renderer.slots.length,
    slot_summaries: renderer.slots.map(buildRendererSlotSummary),
    data_paths: renderer.slots.map((slot) => slot.path),
  };
}
