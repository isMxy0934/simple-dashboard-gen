import type { Binding, DashboardDocument } from "@/contracts";

type ComposeReadinessDraft = {
  dashboardSpec?: DashboardDocument["dashboard_spec"] | null;
  bindings?: Array<Pick<Binding, "view_id" | "slot_id">> | null;
  dirtyViewIds?: string[] | Set<string> | null;
};

function toArray(values: string[] | Set<string> | null | undefined): string[] {
  if (!values) {
    return [];
  }
  return Array.isArray(values) ? values : [...values];
}

function bindingCoversRequiredSlot(input: {
  bindings: Array<Pick<Binding, "view_id" | "slot_id">>;
  viewId: string;
  slotId: string;
}): boolean {
  return input.bindings.some(
    (binding) =>
      binding.view_id === input.viewId &&
      binding.slot_id === input.slotId,
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

  const bindings = (draft.bindings ?? input.dashboard.bindings) as Array<
    Pick<Binding, "view_id" | "slot_id">
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
