import type { DashboardChartLabelKey } from "@/presentation/dashboard/chart-i18n";

const CHART_LABEL_MESSAGE_KEYS: Record<DashboardChartLabelKey, string> = {
  "kpiCard.badgeLive": "chart.kpiCard.badgeLive",
};

export function buildDashboardChartLabels(
  t: (key: string) => string,
): Record<DashboardChartLabelKey, string> {
  return Object.fromEntries(
    Object.entries(CHART_LABEL_MESSAGE_KEYS).map(([labelKey, messageKey]) => [
      labelKey,
      t(messageKey),
    ]),
  ) as Record<DashboardChartLabelKey, string>;
}
