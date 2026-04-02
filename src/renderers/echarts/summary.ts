import type { DashboardRenderer, DashboardRendererSlot } from "@/contracts";
import type { RendererSlotSummary, RendererSummary } from "@/renderers/core/contracts";

function buildRendererSlotSummary(slot: DashboardRendererSlot): RendererSlotSummary {
  return {
    id: slot.id,
    path: slot.path,
    value_kind: slot.value_kind,
    required: slot.required !== false,
  };
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
