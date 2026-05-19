import type { DashboardDocument } from "@/contracts";
import type { DashboardChartLabelKey } from "@/presentation/dashboard/chart-i18n";
import {
  resolveViewPresentationContext,
  type ChartPresentationOptions,
} from "@/presentation/dashboard/presentation-context";

export function resolveAuthoringPreviewChartPresentation(input: {
  document: DashboardDocument;
  chartLabels?: Partial<Record<DashboardChartLabelKey, string>> | null;
}): ChartPresentationOptions {
  return resolveViewPresentationContext(input.document, {
    chartLabels: input.chartLabels,
  }).chartPresentation;
}
