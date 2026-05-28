import type { DashboardDocument, DashboardFilter } from "../../../contracts";

export function groupFiltersForViewer(dashboard: DashboardDocument): {
  templateShared: DashboardFilter[];
  viewLocalByViewId: Map<string, DashboardFilter[]>;
} {
  const templateShared = dashboard.dashboard_spec.filters.filter(
    (filter) => filter.scope === "template_shared",
  );
  const viewLocalByViewId = new Map<string, DashboardFilter[]>();

  for (const filter of dashboard.dashboard_spec.filters) {
    if (filter.scope !== "view_local" || !filter.owner_view_id) {
      continue;
    }
    const current = viewLocalByViewId.get(filter.owner_view_id) ?? [];
    current.push(filter);
    viewLocalByViewId.set(filter.owner_view_id, current);
  }

  return { templateShared, viewLocalByViewId };
}
