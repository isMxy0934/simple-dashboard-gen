import type { DashboardViewKind } from "@/contracts/dashboard-view-intent";

export const SEMANTIC_SKILL_ID_BY_VIEW_KIND: Record<DashboardViewKind, string> = {
  stat_kpi: "stat-kpi",
  time_trend: "time-trend",
  category_comparison: "category-comparison",
  ranked_bar: "ranked-bar",
  signal_list: "signal-list",
  funnel: "funnel",
  bounded_gauge: "bounded-gauge",
};

const VIEW_KIND_BY_SEMANTIC_SKILL_ID = Object.fromEntries(
  Object.entries(SEMANTIC_SKILL_ID_BY_VIEW_KIND).map(([viewKind, skillId]) => [
    skillId,
    viewKind,
  ]),
) as Record<string, DashboardViewKind | undefined>;

export function getViewKindForSemanticSkillId(
  skillId: string,
): DashboardViewKind | null {
  return VIEW_KIND_BY_SEMANTIC_SKILL_ID[skillId] ?? null;
}

export function getSemanticSkillIdForViewKind(
  viewKind: DashboardViewKind,
): string {
  return SEMANTIC_SKILL_ID_BY_VIEW_KIND[viewKind];
}

export function semanticViewKindsForSkillIds(
  skillIds: Iterable<string>,
): DashboardViewKind[] {
  const viewKinds = new Set<DashboardViewKind>();
  for (const skillId of skillIds) {
    const viewKind = getViewKindForSemanticSkillId(skillId);
    if (viewKind) {
      viewKinds.add(viewKind);
    }
  }
  return [...viewKinds];
}
