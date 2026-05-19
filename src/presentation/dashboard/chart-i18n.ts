import type { JsonArray, JsonObject, JsonValue } from "@/contracts";

export const DASHBOARD_CHART_LABEL_DEFINITIONS = [
  {
    key: "kpiCard.badgeLive",
    messageKey: "chart.kpiCard.badgeLive",
    fallback: "Live",
  },
  {
    key: "series.actual",
    messageKey: "chart.series.actual",
    fallback: "Actual",
  },
] as const;

export type DashboardChartLabelKey =
  (typeof DASHBOARD_CHART_LABEL_DEFINITIONS)[number]["key"];

export type DashboardChartLabelMessageKey =
  (typeof DASHBOARD_CHART_LABEL_DEFINITIONS)[number]["messageKey"];

export interface DashboardChartI18nRef extends JsonObject {
  $i18n: DashboardChartLabelKey;
}

export const DEFAULT_DASHBOARD_CHART_LABELS = Object.fromEntries(
  DASHBOARD_CHART_LABEL_DEFINITIONS.map((entry) => [entry.key, entry.fallback]),
) as Record<DashboardChartLabelKey, string>;

export function dashboardChartI18nRef(key: DashboardChartLabelKey): DashboardChartI18nRef {
  return { $i18n: key };
}

export function resolveDashboardChartLabel(
  key: DashboardChartLabelKey,
  labels?: Record<string, string> | null,
): string {
  return labels?.[key] ?? DEFAULT_DASHBOARD_CHART_LABELS[key];
}

export function resolveDashboardChartI18nRefs<T extends JsonValue>(
  value: T,
  labels?: Record<string, string> | null,
): T {
  return resolveDashboardChartI18nRefsWithLabels(value, labels) as T;
}

function resolveDashboardChartI18nRefsWithLabels(
  value: JsonValue,
  labels?: Record<string, string> | null,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      resolveDashboardChartI18nRefsWithLabels(entry, labels),
    ) as JsonArray;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if (isDashboardChartI18nRef(value)) {
    return resolveDashboardChartLabel(value.$i18n, labels);
  }

  const next: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] =
      entry === undefined
        ? undefined
        : resolveDashboardChartI18nRefsWithLabels(entry, labels);
  }
  return next;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardChartI18nRef(value: JsonObject): value is DashboardChartI18nRef {
  const keys = Object.keys(value);
  return keys.length === 1 && typeof value.$i18n === "string";
}
