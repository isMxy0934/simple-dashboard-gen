import type { Binding, DashboardDocument } from "@/contracts";

type ComposeReadinessDraft = {
  dashboardSpec?: DashboardDocument["dashboard_spec"] | null;
  bindings?: Array<Pick<Binding, "view_id" | "slot_id" | "mode" | "query_id">> | null;
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
  bindings: Array<Pick<Binding, "view_id" | "slot_id" | "mode" | "query_id">>;
  viewId: string;
  slotId: string;
  requireLiveBinding: boolean;
}): boolean {
  return input.bindings.some(
    (binding) =>
      binding.view_id === input.viewId &&
      binding.slot_id === input.slotId &&
      (!input.requireLiveBinding ||
        ((binding.mode ?? "live") === "live" && Boolean(binding.query_id))),
  );
}

function draftHasDataContract(draft: ComposeReadinessDraft): boolean {
  return (
    Boolean(draft.queryDefs?.length) ||
    toArray(draft.dirtyQueryIds).length > 0 ||
    draft.bindingMode === "live" ||
    Boolean(draft.bindings?.some((binding) => (binding.mode ?? "live") === "live"))
  );
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

  const requireLiveBinding = draftHasDataContract(draft);
  const bindings = (draft.bindings ?? input.dashboard.bindings) as Array<
    Pick<Binding, "view_id" | "slot_id" | "mode" | "query_id">
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
              requireLiveBinding,
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
