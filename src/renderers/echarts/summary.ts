import type {
  DashboardRenderer,
  DashboardRendererSlot,
  DashboardRendererTransform,
} from "@/contracts";
import type {
  RendererSlotSummary,
  RendererSummary,
  RendererTransformSummary,
} from "@/renderers/core/contracts";

function buildRendererSlotSummary(slot: DashboardRendererSlot): RendererSlotSummary {
  return {
    id: slot.id,
    path: slot.path,
    value_kind: slot.value_kind,
    required: slot.required !== false,
  };
}

function buildRendererTransformSummary(
  transform: DashboardRendererTransform,
): RendererTransformSummary {
  if (transform.kind === "pivot_rows") {
    return {
      id: transform.id,
      kind: transform.kind,
      source: transform.source_slot,
      target_path: transform.target_path,
    };
  }

  return {
    id: transform.id,
    kind: transform.kind,
    source: transform.source_transform,
    target_path: transform.target_path,
  };
}

export function summarizeEChartsRenderer(renderer: DashboardRenderer): RendererSummary {
  return {
    kind: renderer.kind,
    option_keys: Object.keys(renderer.option_template ?? {}).sort(),
    option_template_is_empty: Object.keys(renderer.option_template ?? {}).length === 0,
    slot_count: renderer.slots.length,
    slot_summaries: renderer.slots.map(buildRendererSlotSummary),
    transform_count: renderer.transforms?.length ?? 0,
    transform_summaries: renderer.transforms?.map(buildRendererTransformSummary) ?? [],
    data_paths: renderer.slots.map((slot) => slot.path),
  };
}
