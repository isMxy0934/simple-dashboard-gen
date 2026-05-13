import type { BindingResult, DashboardRendererSlot, JsonValue } from "@/contracts";
import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
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

export function mergeResponsiveEChartsTemplate(
  template: EChartsOptionTemplate,
): EChartsOptionTemplate {
  const option = clone(template) as Record<string, unknown>;
  mergeGrid(option);
  mergeTooltip(option);
  mergeSeries(option);
  mergeAxisLabels(option, "xAxis");
  mergeAxisLabels(option, "yAxis");
  return option as EChartsOptionTemplate;
}

/**
 * 将 long-format rows（time_value, series_value, metric_value）pivot 为 ECharts
 * dataset 的 header-array 格式，并返回对应的 series 名称列表。
 */
function pivotMultiSeriesData(
  rows: Array<Record<string, unknown>>,
  seriesKeyField: string,
  timeField: string,
  valueField: string,
): { datasetSource: unknown[][]; seriesNames: string[] } {
  const seriesSet = new Set<string>();
  for (const row of rows) {
    seriesSet.add(String(row[seriesKeyField] ?? ""));
  }
  const seriesNames = [...seriesSet];

  const byTime = new Map<string, Record<string, number | null>>();
  const timeOrder: string[] = [];
  for (const row of rows) {
    const t = String(row[timeField] ?? "");
    const s = String(row[seriesKeyField] ?? "");
    const v = (row[valueField] as number | null | undefined) ?? null;
    if (!byTime.has(t)) {
      byTime.set(t, {});
      timeOrder.push(t);
    }
    byTime.get(t)![s] = v;
  }

  const header = [timeField, ...seriesNames];
  const dataRows = timeOrder.map((t) => {
    const vals = byTime.get(t)!;
    return [t, ...seriesNames.map((s) => vals[s] ?? null)];
  });

  return { datasetSource: [header, ...dataRows], seriesNames };
}

export function injectBindingResultIntoEChartsOptionTemplate(
  template: EChartsOptionTemplate,
  slot: DashboardRendererSlot,
  bindingResult: BindingResult | undefined,
): EChartsOptionTemplate {
  // 多系列 pivot 模式：将 long-format rows 转换为 wide-format dataset + 动态 series
  if (slot.series_key_field) {
    const seriesKeyField = slot.series_key_field;
    const timeField = slot.time_field ?? "time_value";
    const valueField = slot.value_field ?? "metric_value";

    const rows = getBindingResultRows(bindingResult) as Array<Record<string, unknown>>;
    const { datasetSource, seriesNames } = pivotMultiSeriesData(
      rows,
      seriesKeyField,
      timeField,
      valueField,
    );

    const seriesEntries = seriesNames.map((name) => ({
      type: "line",
      name,
      smooth: true,
      showSymbol: false,
      encode: { x: timeField, y: name },
    }));

    let result = injectValueIntoTemplate(
      clone(template),
      slot.path,
      datasetSource as unknown as JsonValue,
    );
    result = injectValueIntoTemplate(result, "series", seriesEntries as unknown as JsonValue);
    return result as EChartsOptionTemplate;
  }

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
  bindingResults: Array<{
    slot_id: string;
    result?: BindingResult;
  }>;
}): EChartsOptionTemplate {
  const slotsById = new Map(input.slots.map((slot) => [slot.id, slot]));

  return input.bindingResults.reduce((currentTemplate, entry) => {
    const slot = slotsById.get(entry.slot_id);
    if (!slot) {
      return currentTemplate;
    }

    return injectBindingResultIntoEChartsOptionTemplate(
      currentTemplate,
      slot,
      entry.result,
    );
  }, clone(input.template));
}
