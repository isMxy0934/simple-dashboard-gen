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
import type { ViewFamilyId } from "./dashboard-view-family-registry";

export type DashboardTemplateCapabilityId = typeof CANONICAL_DASHBOARD_TEMPLATE_ID;

export interface TemplateViewKindCapability {
  recipeId: EChartsStageChartRecipeId;
  bodyContract: "shell_chrome_forbidden";
  viewFamilyId: ViewFamilyId;
}

export const TEMPLATE_CAPABILITIES: Record<
  DashboardTemplateCapabilityId,
  Record<DashboardViewKind, TemplateViewKindCapability>
> = {
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
};

export function normalizeTemplateCapabilityId(
  templateId: string | null | undefined,
): DashboardTemplateCapabilityId | null {
  return templateId === CANONICAL_DASHBOARD_TEMPLATE_ID
    ? CANONICAL_DASHBOARD_TEMPLATE_ID
    : null;
}

export function resolveLegacyTemplateCapabilityId(
  designKitId: string | null | undefined,
): DashboardTemplateCapabilityId | null {
  if (
    designKitId === OPERATIONAL_REPORT_DESIGN_KIT_ID ||
    designKitId === EXECUTIVE_REPORT_DESIGN_KIT_ID
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
