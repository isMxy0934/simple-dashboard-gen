import type {
  BindingResult,
  DashboardRendererSlot,
  DashboardRendererTransform,
  JsonObject,
  JsonValue,
} from "@/contracts";
import type { ChartPresentationOptions } from "@/presentation/dashboard/presentation-context";
import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import {
  DEFAULT_DASHBOARD_CHART_LABELS,
  resolveDashboardChartI18nRefs,
} from "@/presentation/dashboard/chart-i18n";
import {
  migrateDashboardRendererCompatibility,
  migrateDashboardRendererThemeColorRefs,
} from "@/presentation/dashboard/renderer-compatibility";
import { resolveDashboardThemeRefs } from "@/presentation/dashboard/themes";
import { formatRendererSlotValue } from "@/renderers/core/format-slot-value";
import {
  getBindingResultRows,
  getBindingResultValue,
  injectValueIntoTemplate,
} from "@/renderers/core/slot-path";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DEFAULT_GRID = {
  left: "3%",
  right: "4%",
  top: 36,
  bottom: 32,
  containLabel: true,
};

function mergeGrid(option: Record<string, unknown>): void {
  const grid = option.grid;
  if (grid === undefined) {
    option.grid = { ...DEFAULT_GRID };
    return;
  }
  if (Array.isArray(grid)) {
    option.grid = grid.map((entry) =>
      isPlainObject(entry) ? { ...DEFAULT_GRID, ...entry } : entry,
    );
    return;
  }
  if (isPlainObject(grid)) {
    option.grid = { ...DEFAULT_GRID, ...grid };
  }
}

function mergeTooltip(option: Record<string, unknown>): void {
  const tooltip = option.tooltip;
  if (!isPlainObject(tooltip)) {
    option.tooltip = { confine: true };
    return;
  }
  option.tooltip = { confine: true, ...tooltip };
}

function mergeSeries(option: Record<string, unknown>): void {
  const series = option.series;
  if (!Array.isArray(series)) {
    return;
  }
  option.series = series.map((item) => {
    if (!isPlainObject(item)) {
      return item;
    }
    const type = item.type;
    if (type === "bar") {
      return {
        barMaxWidth: 52,
        barCategoryGap: "40%",
        ...item,
      };
    }
    if (type === "line") {
      return {
        symbolSize: 5,
        ...item,
      };
    }
    if (type === "pie") {
      if (item.radius === undefined) {
        return { radius: ["40%", "65%"], ...item };
      }
      return item;
    }
    return item;
  });
}

function wrapAxis(axis: unknown, key: "xAxis" | "yAxis"): unknown {
  if (!isPlainObject(axis)) {
    return axis;
  }
  const previousAxisLabel = isPlainObject(axis.axisLabel) ? axis.axisLabel : {};
  return {
    ...axis,
    axisLabel: {
      hideOverlap: true,
      margin: key === "yAxis" ? 10 : 8,
      ...previousAxisLabel,
    },
  };
}

function mergeAxisLabels(option: Record<string, unknown>, key: "xAxis" | "yAxis"): void {
  const axis = option[key];
  if (axis === undefined) {
    return;
  }
  if (Array.isArray(axis)) {
    option[key] = axis.map((entry) => wrapAxis(entry, key));
    return;
  }
  option[key] = wrapAxis(axis, key);
}

function resolvePresentationRefs<T extends EChartsOptionTemplate>(
  template: T,
  options?: ChartPresentationOptions | null,
): T {
  const chartLabels = {
    ...DEFAULT_DASHBOARD_CHART_LABELS,
    ...options?.chartLabels,
  };
  return resolveDashboardThemeRefs(
    resolveDashboardChartI18nRefs(clone(template), chartLabels),
    options?.themeId,
  ) as T;
}

export function mergeResponsiveEChartsTemplate(
  template: EChartsOptionTemplate,
  options?: ChartPresentationOptions | null,
): EChartsOptionTemplate {
  const option = resolvePresentationRefs(
    template,
    options,
  ) as Record<string, unknown>;
  mergeGrid(option);
  mergeTooltip(option);
  mergeSeries(option);
  mergeAxisLabels(option, "xAxis");
  mergeAxisLabels(option, "yAxis");
  return option as EChartsOptionTemplate;
}

interface PivotRowsResult {
  datasetSource: unknown[][];
  seriesNames: string[];
}

function toDimensionName(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Unspecified";
  }

  return String(value);
}

function toCellValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  return null;
}

function pivotRowsData(
  rows: Array<Record<string, unknown>>,
  rowKey: string,
  columnKey: string,
  valueField: string,
): PivotRowsResult {
  const seriesSet = new Set<string>();
  for (const row of rows) {
    seriesSet.add(toDimensionName(row[columnKey]));
  }
  const seriesNames = [...seriesSet];

  const byRow = new Map<string, Record<string, JsonValue>>();
  const rowOrder: string[] = [];
  for (const row of rows) {
    const rowName = toDimensionName(row[rowKey]);
    const seriesName = toDimensionName(row[columnKey]);
    const value = toCellValue(row[valueField]);
    if (!byRow.has(rowName)) {
      byRow.set(rowName, {});
      rowOrder.push(rowName);
    }
    byRow.get(rowName)![seriesName] = value;
  }

  const header = [rowKey, ...seriesNames];
  const dataRows = rowOrder.map((rowName) => {
    const values = byRow.get(rowName)!;
    return [rowName, ...seriesNames.map((seriesName) => values[seriesName] ?? null)];
  });

  return { datasetSource: [header, ...dataRows], seriesNames };
}

function isPivotRowsTransform(
  transform: DashboardRendererTransform,
): transform is Extract<DashboardRendererTransform, { kind: "pivot_rows" }> {
  return transform.kind === "pivot_rows";
}

function isGenerateSeriesTransform(
  transform: DashboardRendererTransform,
): transform is Extract<DashboardRendererTransform, { kind: "generate_series" }> {
  return transform.kind === "generate_series";
}

function getJsonObject(value: JsonObject | undefined): JsonObject {
  return isPlainObject(value) ? value : {};
}

function applyRendererTransforms(input: {
  template: EChartsOptionTemplate;
  transforms: DashboardRendererTransform[];
  bindingResultsBySlotId: Map<string, BindingResult | undefined>;
}): EChartsOptionTemplate {
  let option = input.template;
  const transformResults = new Map<string, PivotRowsResult>();

  for (const transform of input.transforms) {
    if (isPivotRowsTransform(transform)) {
      const rows = getBindingResultRows(
        input.bindingResultsBySlotId.get(transform.source_slot),
      ) as Array<Record<string, unknown>>;
      const pivotResult = pivotRowsData(
        rows,
        transform.row_key,
        transform.column_key,
        transform.value_field,
      );
      transformResults.set(transform.id, pivotResult);
      option = injectValueIntoTemplate(
        option,
        transform.target_path,
        pivotResult.datasetSource as unknown as JsonValue,
      ) as EChartsOptionTemplate;
      continue;
    }

    if (isGenerateSeriesTransform(transform)) {
      const source = transformResults.get(transform.source_transform);
      if (!source) {
        throw new Error(
          `Renderer transform "${transform.id}" references missing source_transform "${transform.source_transform}".`,
        );
      }
      const defaults = getJsonObject(transform.defaults);
      const defaultEncode = isPlainObject(defaults.encode) ? defaults.encode : {};
      const seriesEntries = source.seriesNames.map((name) => ({
        ...defaults,
        type: transform.series_type,
        name,
        encode: {
          ...defaultEncode,
          x: transform.encode_x,
          y: name,
        },
      }));

      option = injectValueIntoTemplate(
        option,
        transform.target_path,
        seriesEntries as unknown as JsonValue,
      ) as EChartsOptionTemplate;
    }
  }

  return option;
}

export function injectBindingResultIntoEChartsOptionTemplate(
  template: EChartsOptionTemplate,
  slot: DashboardRendererSlot,
  bindingResult: BindingResult | undefined,
): EChartsOptionTemplate {
  const rawValue = getBindingResultValue(bindingResult);
  const value =
    rawValue === undefined
      ? undefined
      : formatRendererSlotValue(rawValue, slot.formatter);
  if (value === undefined) {
    return clone(template);
  }

  return injectValueIntoTemplate(template, slot.path, value) as EChartsOptionTemplate;
}

export function materializeEChartsOptionTemplate(input: {
  template: EChartsOptionTemplate;
  slots: DashboardRendererSlot[];
  transforms?: DashboardRendererTransform[];
  presentation?: ChartPresentationOptions | null;
  bindingResults: Array<{
    slot_id: string;
    result?: BindingResult;
  }>;
}): EChartsOptionTemplate {
  const compatibility = migrateDashboardRendererCompatibility({
    kind: "echarts",
    option_template: input.template,
    slots: input.slots,
    transforms: input.transforms,
  });
  const themeColorCompatibility = migrateDashboardRendererThemeColorRefs(
    compatibility.renderer,
  );
  const renderer = themeColorCompatibility.renderer;
  const slotsById = new Map(renderer.slots.map((slot) => [slot.id, slot]));
  const bindingResultsBySlotId = new Map(
    input.bindingResults.map((entry) => [entry.slot_id, entry.result] as const),
  );
  const option = input.bindingResults.reduce((currentTemplate, entry) => {
    const slot = slotsById.get(entry.slot_id);
    if (!slot) {
      return currentTemplate;
    }

    return injectBindingResultIntoEChartsOptionTemplate(
      currentTemplate,
      slot,
      entry.result,
    );
  }, clone(renderer.option_template));

  const transformedOption = applyRendererTransforms({
    template: option,
    transforms: renderer.transforms ?? [],
    bindingResultsBySlotId,
  });

  return mergeResponsiveEChartsTemplate(transformedOption, input.presentation);
}
