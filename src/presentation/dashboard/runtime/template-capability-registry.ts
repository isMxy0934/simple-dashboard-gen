import type { EChartsStageChartRecipeId } from "@/contracts/dashboard-chart-recipes";
import {
  EXECUTIVE_REPORT_DESIGN_KIT_ID,
  OPERATIONAL_REPORT_DESIGN_KIT_ID,
} from "@/contracts/dashboard-presentation";
import type { DashboardViewKind } from "@/contracts/dashboard-view-intent";
import {
  CANONICAL_DASHBOARD_TEMPLATE_ID,
} from "@/contracts/dashboard-templates";

import type { ViewFamilyId } from "./view-family-registry";

export interface TemplateViewKindCapability {
  recipeId: EChartsStageChartRecipeId;
  bodyContract: "shell_chrome_forbidden";
  viewFamilyId: ViewFamilyId;
}

const TEMPLATE_CAPABILITIES = {
  [CANONICAL_DASHBOARD_TEMPLATE_ID]: {
    stat_kpi: {
      recipeId: "echarts-kpi-card",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "kpi",
    },
    time_trend: {
      recipeId: "echarts-line",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "trend",
    },
    category_comparison: {
      recipeId: "echarts-bar",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "analysis",
    },
    ranked_bar: {
      recipeId: "echarts-ranked-bar",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "analysis",
    },
    signal_list: {
      recipeId: "echarts-signal-list",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "signal",
    },
    funnel: {
      recipeId: "echarts-funnel",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "analysis",
    },
    bounded_gauge: {
      recipeId: "echarts-kpi-gauge",
      bodyContract: "shell_chrome_forbidden",
      viewFamilyId: "kpi",
    },
  },
} as const satisfies Record<
  typeof CANONICAL_DASHBOARD_TEMPLATE_ID,
  Record<DashboardViewKind, TemplateViewKindCapability>
>;

function normalizeTemplateCapabilityId(templateId: string): typeof CANONICAL_DASHBOARD_TEMPLATE_ID | null {
  if (
    templateId === CANONICAL_DASHBOARD_TEMPLATE_ID ||
    templateId === OPERATIONAL_REPORT_DESIGN_KIT_ID ||
    templateId === EXECUTIVE_REPORT_DESIGN_KIT_ID
  ) {
    return CANONICAL_DASHBOARD_TEMPLATE_ID;
  }
  return null;
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
