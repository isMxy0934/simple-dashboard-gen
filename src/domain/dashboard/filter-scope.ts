import type { DashboardFilter } from "../../contracts";

export function isFilterApplicableToViewIds(
  filter: DashboardFilter,
  visibleViewIds: ReadonlySet<string>,
): boolean {
  if (filter.scope === "workspace_shared") {
    return false;
  }

  if (filter.scope === "template_shared") {
    return filter.affected_view_ids?.some((viewId) => visibleViewIds.has(viewId)) ?? false;
  }

  if (filter.scope === "view_local") {
    return filter.owner_view_id ? visibleViewIds.has(filter.owner_view_id) : false;
  }

  return false;
}

export function getApplicableRenderableFilters(
  filters: DashboardFilter[],
  visibleViewIds: Iterable<string>,
): DashboardFilter[] {
  const visibleViewIdSet = new Set(visibleViewIds);
  return filters.filter((filter) => isFilterApplicableToViewIds(filter, visibleViewIdSet));
}
