import type { DashboardDocument, DashboardPresentation } from "@/contracts";
import {
  DEFAULT_DASHBOARD_CHART_LABELS,
  type DashboardChartLabelKey,
} from "@/presentation/dashboard/chart-i18n";
import { resolveDashboardTemplate } from "@/domain/dashboard/templates";
import {
  dashboardThemeCssVariables,
  resolveDashboardTheme,
  type DashboardTheme,
} from "@/presentation/dashboard/themes";

export interface ChartPresentationOptions {
  themeId?: string | null;
  chartLabels?: Partial<Record<DashboardChartLabelKey, string>> | null;
}

export interface DashboardViewPresentationContext {
  presentation: DashboardPresentation;
  theme: DashboardTheme;
  chartPresentation: ChartPresentationOptions;
  isReportSurface: boolean;
  cssVariables?: Record<`--${string}`, string>;
}

export function resolveDashboardPresentation(
  dashboard: DashboardDocument,
): DashboardPresentation {
  const template = resolveDashboardTemplate(dashboard.dashboard_spec.template);
  return dashboard.dashboard_spec.presentation ?? template.presentation;
}

export function resolveViewPresentationContext(
  dashboard: DashboardDocument,
  options: {
    chartLabels?: Partial<Record<DashboardChartLabelKey, string>> | null;
  } = {},
): DashboardViewPresentationContext {
  const presentation = resolveDashboardPresentation(dashboard);
  const theme = resolveDashboardTheme(presentation.theme_id);
  const chartLabels = {
    ...DEFAULT_DASHBOARD_CHART_LABELS,
    ...options.chartLabels,
  };
  const isReportSurface =
    presentation.card_chrome === "report" ||
    theme.surface === "report";

  return {
    presentation,
    theme,
    chartPresentation: {
      themeId: theme.id,
      chartLabels,
    },
    isReportSurface,
    cssVariables: isReportSurface ? dashboardThemeCssVariables(theme.id) : undefined,
  };
}
