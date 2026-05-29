import type { DashboardDocument } from "./dashboard";
import type { EChartsStageChartRecipeId } from "./dashboard-chart-recipes";
import {
  EXECUTIVE_REPORT_DESIGN_KIT_ID,
  normalizeDashboardDesignKitId,
  OPERATIONAL_REPORT_DESIGN_KIT_ID,
} from "./dashboard-presentation";
import {
  CANONICAL_DASHBOARD_TEMPLATE_ID,
} from "./dashboard-templates";
import type { DashboardViewKind } from "./dashboard-view-intent";
import type { ViewFamilyDefinition, ViewFamilyId } from "./dashboard-view-family-registry";

export interface TemplateDensityContract {
  pagePaddingY: string;
  pagePaddingX: string;
  canvasPadding: string;
  toolbarPadding: string;
  gridGap: string;
  cardHeaderPadding: string;
  rowHeight: {
    min: number;
    desktop: number;
    mobile: number;
  };
}

export type TemplateViewBodyComposition =
  | "metric_value_text"
  | "gauge_progress"
  | "time_series_line"
  | "vertical_category_bar"
  | "horizontal_ranked_bar"
  | "signal_bar_list"
  | "funnel_progress_steps";

export type TemplateViewResponsivePolicy =
  | "graphic_elements_media"
  | "gauge_series_layout"
  | "grid_axis_series"
  | "horizontal_bar_labels"
  | "signal_list_labels"
  | "funnel_step_labels";

export interface TemplateViewVisualTokens {
  cardBorderColor?: string;
  cardRadius?: string;
  cardShadow?: string;
  headerPadding?: string;
  inlineFilterPaddingTop?: string;
  bodyPadding?: string;
  bodyBackground?: string;
}

export interface TemplateViewKindVisualContract {
  cardChrome: ViewFamilyDefinition["cardChrome"];
  headerLayout: ViewFamilyDefinition["headerLayout"];
  bodyStyle: ViewFamilyDefinition["bodyStyle"];
  statusPlacement: ViewFamilyDefinition["statusPlacement"];
  localFilterPlacement: ViewFamilyDefinition["localFilterPlacement"];
  preview: ViewFamilyDefinition["preview"];
  bodyComposition: TemplateViewBodyComposition;
  responsivePolicy: TemplateViewResponsivePolicy;
  defaultSize: {
    desktop: { w: number; h: number };
    mobile: { w: number; h: number };
  };
  tokens?: TemplateViewVisualTokens;
}

export interface TemplateViewKindCapability {
  recipeId: EChartsStageChartRecipeId;
  bodyContract: "shell_chrome_forbidden";
  viewFamilyId: ViewFamilyId;
  visual: TemplateViewKindVisualContract;
}

export interface TemplateVisualContract {
  density: TemplateDensityContract;
  views: Record<DashboardViewKind, TemplateViewKindCapability>;
}

export const VISUAL_CONTRACT_TEST_TEMPLATE_ID = "report_runtime_visual_contract_test";

const METRIC_CHROME = {
  cardChrome: "kpi",
  headerLayout: "metric",
  bodyStyle: "metric",
  statusPlacement: "inline",
  localFilterPlacement: "inline",
  preview: {
    width: "half",
    body: "metric",
  },
  tokens: {
    headerPadding: "16px 18px 10px",
    inlineFilterPaddingTop: "10px",
    bodyPadding: "0 16px 18px",
    bodyBackground:
      "linear-gradient(180deg, color-mix(in srgb, var(--dashboard-theme-header) 7%, white), transparent 58%), var(--dashboard-theme-card)",
  },
} as const satisfies Pick<
  TemplateViewKindVisualContract,
  | "cardChrome"
  | "headerLayout"
  | "bodyStyle"
  | "statusPlacement"
  | "localFilterPlacement"
  | "preview"
  | "tokens"
>;

const CHART_CHROME = {
  cardChrome: "chart",
  headerLayout: "section",
  bodyStyle: "chart",
  statusPlacement: "topline",
  localFilterPlacement: "toolbar",
  preview: {
    width: "wide",
    body: "analysis",
  },
  tokens: {
    bodyPadding: "8px 16px 18px",
  },
} as const satisfies Pick<
  TemplateViewKindVisualContract,
  | "cardChrome"
  | "headerLayout"
  | "bodyStyle"
  | "statusPlacement"
  | "localFilterPlacement"
  | "preview"
  | "tokens"
>;

const SIGNAL_CHROME = {
  cardChrome: "signal",
  headerLayout: "compact",
  bodyStyle: "signal",
  statusPlacement: "inline",
  localFilterPlacement: "inline",
  preview: {
    width: "half",
    body: "signal",
  },
  tokens: {
    bodyPadding: "0 16px 16px",
    inlineFilterPaddingTop: "6px",
    bodyBackground:
      "linear-gradient(180deg, color-mix(in srgb, var(--dashboard-theme-control-bar) 48%, white), transparent 82%), var(--dashboard-theme-card)",
  },
} as const satisfies Pick<
  TemplateViewKindVisualContract,
  | "cardChrome"
  | "headerLayout"
  | "bodyStyle"
  | "statusPlacement"
  | "localFilterPlacement"
  | "preview"
  | "tokens"
>;

const CANONICAL_TEMPLATE_VISUAL_CONTRACT = {
  density: {
    pagePaddingY: "30px",
    pagePaddingX: "42px",
    canvasPadding: "20px 28px 28px",
    toolbarPadding: "12px 28px",
    gridGap: "10px",
    cardHeaderPadding: "16px 18px 10px",
    rowHeight: {
      min: 14,
      desktop: 24,
      mobile: 24,
    },
  },
  views: {
    stat_kpi: {
      recipeId: "echarts-kpi-card",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "kpi",
      visual: {
        ...METRIC_CHROME,
        bodyComposition: "metric_value_text",
        responsivePolicy: "graphic_elements_media",
        defaultSize: { desktop: { w: 3, h: 2 }, mobile: { w: 4, h: 2 } },
      },
    },
    time_trend: {
      recipeId: "echarts-line",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "trend",
      visual: {
        ...CHART_CHROME,
        preview: { width: "wide", body: "trend" },
        bodyComposition: "time_series_line",
        responsivePolicy: "grid_axis_series",
        defaultSize: { desktop: { w: 8, h: 6 }, mobile: { w: 4, h: 6 } },
      },
    },
    category_comparison: {
      recipeId: "echarts-bar",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "analysis",
      visual: {
        ...CHART_CHROME,
        bodyComposition: "vertical_category_bar",
        responsivePolicy: "grid_axis_series",
        defaultSize: { desktop: { w: 6, h: 6 }, mobile: { w: 4, h: 6 } },
      },
    },
    ranked_bar: {
      recipeId: "echarts-ranked-bar",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "analysis",
      visual: {
        ...CHART_CHROME,
        bodyComposition: "horizontal_ranked_bar",
        responsivePolicy: "horizontal_bar_labels",
        defaultSize: { desktop: { w: 6, h: 5 }, mobile: { w: 4, h: 5 } },
      },
    },
    signal_list: {
      recipeId: "echarts-signal-list",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "signal",
      visual: {
        ...SIGNAL_CHROME,
        bodyComposition: "signal_bar_list",
        responsivePolicy: "signal_list_labels",
        defaultSize: { desktop: { w: 4, h: 6 }, mobile: { w: 4, h: 6 } },
      },
    },
    funnel: {
      recipeId: "echarts-funnel",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "analysis",
      visual: {
        ...CHART_CHROME,
        bodyComposition: "funnel_progress_steps",
        responsivePolicy: "funnel_step_labels",
        defaultSize: { desktop: { w: 6, h: 5 }, mobile: { w: 4, h: 5 } },
      },
    },
    bounded_gauge: {
      recipeId: "echarts-kpi-gauge",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "kpi",
      visual: {
        ...METRIC_CHROME,
        bodyComposition: "gauge_progress",
        responsivePolicy: "gauge_series_layout",
        defaultSize: { desktop: { w: 4, h: 4 }, mobile: { w: 4, h: 4 } },
      },
    },
  },
} satisfies TemplateVisualContract;

const VISUAL_CONTRACT_TEST_TEMPLATE = {
  density: {
    pagePaddingY: "24px",
    pagePaddingX: "30px",
    canvasPadding: "14px 18px 20px",
    toolbarPadding: "10px 18px",
    gridGap: "6px",
    cardHeaderPadding: "12px 14px 8px",
    rowHeight: {
      min: 12,
      desktop: 20,
      mobile: 20,
    },
  },
  views: {
    ...CANONICAL_TEMPLATE_VISUAL_CONTRACT.views,
    stat_kpi: {
      ...CANONICAL_TEMPLATE_VISUAL_CONTRACT.views.stat_kpi,
      visual: {
        ...CANONICAL_TEMPLATE_VISUAL_CONTRACT.views.stat_kpi.visual,
        defaultSize: { desktop: { w: 2, h: 3 }, mobile: { w: 4, h: 3 } },
        tokens: {
          ...CANONICAL_TEMPLATE_VISUAL_CONTRACT.views.stat_kpi.visual.tokens,
          headerPadding: "12px 14px 8px",
          inlineFilterPaddingTop: "6px",
          bodyPadding: "0 12px 12px",
          bodyBackground:
            "linear-gradient(180deg, color-mix(in srgb, var(--dashboard-theme-control-bar) 18%, white), transparent 54%), var(--dashboard-theme-card)",
        },
      },
    },
  },
} satisfies TemplateVisualContract;

export const TEMPLATE_VISUAL_CONTRACTS = {
  [CANONICAL_DASHBOARD_TEMPLATE_ID]: CANONICAL_TEMPLATE_VISUAL_CONTRACT,
  [VISUAL_CONTRACT_TEST_TEMPLATE_ID]: VISUAL_CONTRACT_TEST_TEMPLATE,
} satisfies Record<string, TemplateVisualContract>;

export const TEMPLATE_CAPABILITIES = Object.fromEntries(
  Object.entries(TEMPLATE_VISUAL_CONTRACTS).map(([templateId, contract]) => [
    templateId,
    contract.views,
  ]),
) as Record<keyof typeof TEMPLATE_VISUAL_CONTRACTS, Record<DashboardViewKind, TemplateViewKindCapability>>;

export type DashboardTemplateCapabilityId = keyof typeof TEMPLATE_CAPABILITIES;

function isTemplateCapabilityId(
  templateId: string,
): templateId is DashboardTemplateCapabilityId {
  return Object.hasOwn(TEMPLATE_CAPABILITIES, templateId);
}

export function normalizeTemplateCapabilityId(
  templateId: string | null | undefined,
): DashboardTemplateCapabilityId | null {
  const normalized = templateId?.trim();
  return normalized && isTemplateCapabilityId(normalized) ? normalized : null;
}

export function resolveLegacyTemplateCapabilityId(
  designKitId: string | null | undefined,
): DashboardTemplateCapabilityId | null {
  const normalized = designKitId?.trim();
  if (
    normalized === OPERATIONAL_REPORT_DESIGN_KIT_ID ||
    normalized === EXECUTIVE_REPORT_DESIGN_KIT_ID
  ) {
    return CANONICAL_DASHBOARD_TEMPLATE_ID;
  }
  return null;
}

export function resolveCompatibleTemplateCapabilityId(
  inputId: string,
): DashboardTemplateCapabilityId | null {
  return (
    normalizeTemplateCapabilityId(inputId) ??
    resolveLegacyTemplateCapabilityId(inputId)
  );
}

export function resolveDashboardTemplateCapabilityId(
  dashboard: Pick<DashboardDocument, "dashboard_spec">,
): DashboardTemplateCapabilityId | null {
  const explicitTemplateId = normalizeTemplateCapabilityId(
    dashboard.dashboard_spec.template?.id,
  );
  if (explicitTemplateId) {
    return explicitTemplateId;
  }
  if (dashboard.dashboard_spec.template?.id?.trim()) {
    return null;
  }
  return resolveCompatibleTemplateCapabilityId(
    normalizeDashboardDesignKitId(dashboard.dashboard_spec.presentation.design_kit_id),
  );
}

export function getTemplateCapability(
  templateId: string,
  viewKind: DashboardViewKind,
): TemplateViewKindCapability | null {
  const normalizedTemplateId = normalizeTemplateCapabilityId(templateId);
  if (!normalizedTemplateId) {
    return null;
  }
  return TEMPLATE_CAPABILITIES[normalizedTemplateId][viewKind];
}

export function getTemplateVisualContract(
  templateId: string,
): TemplateVisualContract | null {
  const normalizedTemplateId = normalizeTemplateCapabilityId(templateId);
  if (!normalizedTemplateId) {
    return null;
  }
  return TEMPLATE_VISUAL_CONTRACTS[normalizedTemplateId];
}

export function getTemplateDensityContract(
  templateId: string,
): TemplateDensityContract | null {
  return getTemplateVisualContract(templateId)?.density ?? null;
}

export function resolveTemplateViewVisualContract(
  templateId: string,
  viewKind: DashboardViewKind,
): TemplateViewKindVisualContract | null {
  return getTemplateCapability(templateId, viewKind)?.visual ?? null;
}

export function listTemplateSupportedViewKinds(
  templateId: string,
): readonly DashboardViewKind[] {
  const normalizedTemplateId = normalizeTemplateCapabilityId(templateId);
  if (!normalizedTemplateId) {
    return [];
  }
  return Object.keys(TEMPLATE_CAPABILITIES[normalizedTemplateId]) as DashboardViewKind[];
}

export function listTemplateCapabilityRecipeIds(
  templateId: string,
): readonly EChartsStageChartRecipeId[] {
  const normalizedTemplateId = normalizeTemplateCapabilityId(templateId);
  if (!normalizedTemplateId) {
    return [];
  }
  return Object.values(TEMPLATE_CAPABILITIES[normalizedTemplateId]).map(
    (capability) => capability.recipeId,
  );
}
