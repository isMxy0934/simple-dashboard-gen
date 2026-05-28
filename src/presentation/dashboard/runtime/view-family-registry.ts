export type ViewFamilyId = "kpi" | "trend" | "signal" | "analysis";

export interface ViewFamilyDefinition {
  id: ViewFamilyId;
  cardChrome: "kpi" | "chart" | "signal";
  localFilterPlacement: "inline" | "toolbar";
}

export const VIEW_FAMILIES: Record<ViewFamilyId, ViewFamilyDefinition> = {
  kpi: { id: "kpi", cardChrome: "kpi", localFilterPlacement: "inline" },
  trend: { id: "trend", cardChrome: "chart", localFilterPlacement: "toolbar" },
  signal: { id: "signal", cardChrome: "signal", localFilterPlacement: "inline" },
  analysis: { id: "analysis", cardChrome: "chart", localFilterPlacement: "toolbar" },
};

export function resolveViewFamily(viewFamilyId: ViewFamilyId): ViewFamilyDefinition {
  return VIEW_FAMILIES[viewFamilyId];
}
