import type { JsonObject } from "@/contracts";

export type EChartsOptionTemplate = JsonObject;
export type EncodeField = string | string[];

export interface EChartsSeriesTemplate extends JsonObject {
  type?: string;
  encode?: Record<string, EncodeField>;
}

export function getEChartsSeries(
  optionTemplate: EChartsOptionTemplate,
): EChartsSeriesTemplate[] {
  const series = optionTemplate.series;
  if (!Array.isArray(series)) {
    return [];
  }

  return series.filter(
    (entry): entry is EChartsSeriesTemplate =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}
