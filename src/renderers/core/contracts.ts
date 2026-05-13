import type { DashboardRendererSlot } from "@/contracts";

export interface RendererSlotSummary {
  id: string;
  path: string;
  value_kind: DashboardRendererSlot["value_kind"];
  required: boolean;
}

export interface RendererTransformSummary {
  id: string;
  kind: string;
  source: string | null;
  target_path: string | null;
}

export interface RendererSummary {
  kind: string;
  option_keys: string[];
  option_template_is_empty: boolean;
  slot_count: number;
  slot_summaries: RendererSlotSummary[];
  transform_count: number;
  transform_summaries: RendererTransformSummary[];
  data_paths: string[];
}
