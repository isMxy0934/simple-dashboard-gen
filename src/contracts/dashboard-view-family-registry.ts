export type ViewFamilyId = "kpi" | "trend" | "signal" | "analysis";

export interface ViewFamilyDefinition {
  id: ViewFamilyId;
  cardChrome: "kpi" | "chart" | "signal";
  headerLayout: "metric" | "section" | "compact";
  bodyStyle: "metric" | "chart" | "signal";
  statusPlacement: "inline" | "topline";
  localFilterPlacement: "inline" | "toolbar";
  preview: {
    width: "half" | "wide";
    body: "metric" | "trend" | "signal" | "analysis";
  };
}

export const VIEW_FAMILIES: Record<ViewFamilyId, ViewFamilyDefinition> = {
  kpi: {
    id: "kpi",
    cardChrome: "kpi",
    headerLayout: "metric",
    bodyStyle: "metric",
    statusPlacement: "inline",
    localFilterPlacement: "inline",
    preview: {
      width: "half",
      body: "metric",
    },
  },
  trend: {
    id: "trend",
    cardChrome: "chart",
    headerLayout: "section",
    bodyStyle: "chart",
    statusPlacement: "topline",
    localFilterPlacement: "toolbar",
    preview: {
      width: "wide",
      body: "trend",
    },
  },
  signal: {
    id: "signal",
    cardChrome: "signal",
    headerLayout: "compact",
    bodyStyle: "signal",
    statusPlacement: "inline",
    localFilterPlacement: "inline",
    preview: {
      width: "half",
      body: "signal",
    },
  },
  analysis: {
    id: "analysis",
    cardChrome: "chart",
    headerLayout: "section",
    bodyStyle: "chart",
    statusPlacement: "topline",
    localFilterPlacement: "toolbar",
    preview: {
      width: "wide",
      body: "analysis",
    },
  },
};

export function resolveViewFamily(viewFamilyId: ViewFamilyId): ViewFamilyDefinition {
  return VIEW_FAMILIES[viewFamilyId];
}
