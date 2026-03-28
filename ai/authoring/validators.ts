import type { DashboardDocument } from "../../contracts";
import type {
  GenerateLayoutInput,
  LayoutBreakpointSpec,
  LayoutViewSpec,
} from "./artifacts";

export function validateLayoutDraftInput(input: GenerateLayoutInput) {
  const proposedIds = input.view_specs.map((view, index) =>
    normalizeViewId(view, index + 1),
  );
  const proposedIdSet = new Set<string>();

  for (const viewId of proposedIds) {
    if (proposedIdSet.has(viewId)) {
      throw new Error(`Layout draft contains duplicate view id "${viewId}".`);
    }
    proposedIdSet.add(viewId);
  }

  const replaceExistingViews = input.replace_existing_views ?? true;
  if (!replaceExistingViews) {
    const currentIds = new Set(
      input.currentDocument.dashboard_spec.views.map((view) => view.id),
    );

    for (const viewId of proposedIds) {
      if (currentIds.has(viewId)) {
        throw new Error(
          `Layout draft cannot append a duplicate view id "${viewId}".`,
        );
      }
    }
  }

  validateLayoutBreakpoint(input.layout?.desktop, proposedIdSet, input.currentDocument);
  validateLayoutBreakpoint(input.layout?.mobile, proposedIdSet, input.currentDocument);
}

function normalizeViewId(spec: LayoutViewSpec, seed: number) {
  return spec.view_id?.trim() || `v_ai_${seed}`;
}

function validateLayoutBreakpoint(
  layout: LayoutBreakpointSpec | undefined,
  proposedViewIds: Set<string>,
  currentDocument: DashboardDocument,
) {
  if (!layout) {
    return;
  }

  const knownViewIds = new Set([
    ...currentDocument.dashboard_spec.views.map((view) => view.id),
    ...proposedViewIds,
  ]);

  for (const item of layout.items) {
    if (!knownViewIds.has(item.view_id)) {
      throw new Error(
        `Layout item references unknown view id "${item.view_id}".`,
      );
    }
  }
}
