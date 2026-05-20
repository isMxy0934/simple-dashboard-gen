import {
  DASHBOARD_CHART_LABEL_DEFINITIONS,
  dashboardChartLabelMessageKey,
  type DashboardChartLabelKey,
} from "@/presentation/dashboard/chart-i18n";

export function buildDashboardChartLabels(
  t: (key: string) => string,
): Record<DashboardChartLabelKey, string> {
  return Object.fromEntries(
    DASHBOARD_CHART_LABEL_DEFINITIONS.map(({ key, fallback }) => {
      const messageKey = dashboardChartLabelMessageKey(key);
      const translated = t(messageKey);
      return [key, translated === messageKey ? fallback : translated];
    }),
  ) as Record<DashboardChartLabelKey, string>;
}
