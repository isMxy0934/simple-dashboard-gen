import type { Binding, DashboardDocument } from "@/contracts";

type ComposeReadinessDraft = {
  dashboardSpec?: DashboardDocument["dashboard_spec"] | null;
  bindings?: Array<Pick<Binding, "view_id" | "slot_id" | "mode" | "query_id" | "mock_data" | "mock_value">> | null;
  bindingMode?: "mock" | "live" | null;
  queryDefs?: unknown[] | null;
  dirtyViewIds?: string[] | Set<string> | null;
  dirtyQueryIds?: string[] | Set<string> | null;
};

function toArray(values: string[] | Set<string> | null | undefined): string[] {
  if (!values) {
    return [];
  }
  return Array.isArray(values) ? values : [...values];
}

function bindingCoversRequiredSlot(input: {
  bindings: Array<Pick<Binding, "view_id" | "slot_id" | "mode" | "query_id" | "mock_data" | "mock_value">>;
  viewId: string;
  slotId: string;
  dataMode: "live" | "mock";
}): boolean {
  return input.bindings.some(
    (binding) =>
      binding.view_id === input.viewId &&
      binding.slot_id === input.slotId &&
      (input.dataMode === "live"
        ? ((binding.mode ?? "live") === "live" && Boolean(binding.query_id))
        : binding.mode === "mock" &&
          ("mock_value" in binding || "mock_data" in binding)),
  );
}

function resolveDataMode(
  draft: ComposeReadinessDraft,
): "live" | "mock" | "undecided" {
  if (draft.bindingMode) {
    return draft.bindingMode;
  }
  if (
    Boolean(draft.queryDefs?.length) ||
    toArray(draft.dirtyQueryIds).length > 0 ||
    Boolean(draft.bindings?.some((binding) => (binding.mode ?? "live") === "live"))
  ) {
    return "live";
  }
  if (draft.bindings?.some((binding) => binding.mode === "mock")) {
    return "mock";
  }
  return "undecided";
}

export function draftNeedsBindingBeforeCompose(input: {
  dashboard: DashboardDocument;
  draft: ComposeReadinessDraft | null | undefined;
}): boolean {
  const draft = input.draft;
  if (!draft) {
    return false;
  }

  const dirtyViewIds = new Set(toArray(draft.dirtyViewIds));
  if (dirtyViewIds.size === 0 || !draft.dashboardSpec) {
    return false;
  }

  const dataMode = resolveDataMode(draft);
  if (dataMode === "undecided") {
    return true;
  }
  const bindings = (draft.bindings ?? input.dashboard.bindings) as Array<
    Pick<Binding, "view_id" | "slot_id" | "mode" | "query_id" | "mock_data" | "mock_value">
  >;

  return draft.dashboardSpec.views
    .filter((view) => dirtyViewIds.has(view.id))
    .some((view) =>
      view.renderer.slots
        .filter((slot) => slot.required !== false)
        .some(
          (slot) =>
            !bindingCoversRequiredSlot({
              bindings,
              viewId: view.id,
              slotId: slot.id,
              dataMode,
            }),
        ),
    );
}

export function isDraftReadyForCompose(input: {
  dashboard: DashboardDocument;
  draft: ComposeReadinessDraft | null | undefined;
}): boolean {
  const draft = input.draft;
  if (!draft) {
    return false;
  }
  return !draftNeedsBindingBeforeCompose(input);
}
