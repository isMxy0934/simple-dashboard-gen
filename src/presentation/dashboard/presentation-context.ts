import type { DashboardDocument, DashboardPresentation } from "@/contracts";
import { normalizeDashboardDesignKitId } from "@/contracts/dashboard-presentation";
import {
  getTemplateDensityContract,
  getTemplateCapability,
  resolveDashboardTemplateCapabilityId,
  type TemplateDensityContract,
  type TemplateViewKindVisualContract,
} from "@/contracts/dashboard-template-capability-registry";
import { resolveViewFamily } from "@/contracts/dashboard-view-family-registry";
import {
  DEFAULT_DASHBOARD_CHART_LABELS,
  type DashboardChartLabelKey,
} from "@/presentation/dashboard/chart-i18n";
import {
  dashboardThemeCssVariables,
  resolveDashboardDesignKit,
  resolveDashboardTheme,
  resolveDashboardViewStyle,
  type DashboardDesignKit,
  type DashboardTheme,
  type DashboardViewStyle,
} from "@/presentation/dashboard/themes";

export interface ChartPresentationOptions {
  designKitId?: string | null;
  colorThemeId?: string | null;
  viewStyleId?: string | null;
  chartLabels?: Partial<Record<DashboardChartLabelKey, string>> | null;
}

export interface DashboardViewPresentationContext {
  presentation: DashboardPresentation;
  designKit: DashboardDesignKit;
  theme: DashboardTheme;
  viewStyle: DashboardViewStyle;
  viewFamily: ReturnType<typeof resolveViewFamily> | null;
  viewVisual: TemplateViewKindVisualContract | null;
  templateDensity: TemplateDensityContract | null;
  chartPresentation: ChartPresentationOptions;
  isReportSurface: boolean;
  cssVariables?: Record<`--${string}`, string>;
}

export function resolveDashboardPresentation(
  dashboard: DashboardDocument,
): DashboardPresentation {
  const presentation = dashboard.dashboard_spec.presentation as DashboardPresentation | undefined;
  if (!presentation) {
    throw new Error("Dashboard presentation is required for schema_version 0.3.");
  }
  return presentation;
}

function requirePresentationId(value: string, fieldName: keyof DashboardPresentation): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Dashboard presentation field "${fieldName}" is required for schema_version 0.3.`);
  }
  return normalized;
}

function optionalPresentationOverride(
  value: string | null | undefined,
  fieldName: string,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Dashboard presentation override "${fieldName}" must be non-empty when provided.`);
  }
  return normalized;
}

export function resolveViewPresentationContext(
  dashboard: DashboardDocument,
  options: {
    viewId?: string | null;
    designKitId?: string | null;
    colorThemeId?: string | null;
    viewStyleId?: string | null;
    chartLabels?: Partial<Record<DashboardChartLabelKey, string>> | null;
  } = {},
): DashboardViewPresentationContext {
  const presentation = resolveDashboardPresentation(dashboard);
  const presentationDesignKitId = requirePresentationId(
    normalizeDashboardDesignKitId(presentation.design_kit_id),
    "design_kit_id",
  );
  const presentationColorThemeId = requirePresentationId(
    presentation.color_theme_id,
    "color_theme_id",
  );
  const presentationDefaultViewStyleId = requirePresentationId(
    presentation.default_view_style_id,
    "default_view_style_id",
  );
  const designKitOverride = optionalPresentationOverride(
    options.designKitId,
    "design_kit_id",
  );
  const designKit = resolveDashboardDesignKit(
    designKitOverride
      ? normalizeDashboardDesignKitId(designKitOverride)
      : presentationDesignKitId,
  );
  const theme = resolveDashboardTheme(
    optionalPresentationOverride(options.colorThemeId, "color_theme_id") ??
      presentationColorThemeId,
    designKit.id,
  );
  const view = options.viewId
    ? dashboard.dashboard_spec.views.find((candidate) => candidate.id === options.viewId)
    : null;
  const templateCapabilityId = resolveDashboardTemplateCapabilityId(dashboard);
  const capability = view?.view_intent
    ? templateCapabilityId
      ? getTemplateCapability(templateCapabilityId, view.view_intent.view_kind)
      : null
    : null;
  const viewStyle = resolveDashboardViewStyle(
    optionalPresentationOverride(options.viewStyleId, "view_style_id") ??
      (view?.view_style_id !== undefined
        ? requirePresentationId(view.view_style_id, "default_view_style_id")
        : presentationDefaultViewStyleId),
    designKit.id,
  );
  const chartLabels = {
    ...DEFAULT_DASHBOARD_CHART_LABELS,
    ...options.chartLabels,
  };
  const isReportSurface = designKit.cardChrome === "report" || theme.surface === "report";
  const templateDensity = templateCapabilityId
    ? getTemplateDensityContract(templateCapabilityId)
    : null;

  return {
    presentation,
    designKit,
    theme,
    viewStyle,
    viewFamily: capability ? resolveViewFamily(capability.viewFamilyId) : null,
    viewVisual: capability?.visual ?? null,
    templateDensity,
    chartPresentation: {
      designKitId: designKit.id,
      colorThemeId: theme.id,
      viewStyleId: viewStyle.id,
      chartLabels,
    },
    isReportSurface,
    cssVariables: isReportSurface
      ? dashboardThemeCssVariables(theme.id, designKit.id, { templateDensity })
      : undefined,
  };
}
