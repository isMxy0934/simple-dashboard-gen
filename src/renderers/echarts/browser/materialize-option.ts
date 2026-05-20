import type {
  BindingResult,
  DashboardRendererSlot,
  DashboardRendererTransform,
  JsonObject,
  JsonValue,
} from "@/contracts";
import type { ChartPresentationOptions } from "@/presentation/dashboard/presentation-context";
import {
  DASHBOARD_VIEW_STYLE_ID_CLEAN,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  DASHBOARD_VIEW_STYLE_ID_GRADIENT,
} from "@/contracts/dashboard-presentation";
import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import {
  DEFAULT_DASHBOARD_CHART_LABELS,
  resolveDashboardChartI18nRefs,
} from "@/presentation/dashboard/chart-i18n";
import {
  resolveDashboardTheme,
  resolveDashboardThemeRefs,
} from "@/presentation/dashboard/themes";
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
    option.tooltip = { confine: true, trigger: "axis" };
    return;
  }
  option.tooltip = { confine: true, trigger: "axis", ...tooltip };
}

function makeLinearGradient(from: string, to: string): JsonObject {
  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: from },
      { offset: 1, color: to },
    ],
  };
}

function isHorizontalBarSeries(item: Record<string, unknown>): boolean {
  const encode = item.encode;
  if (!isPlainObject(encode)) {
    return false;
  }
  return encode.x !== undefined && encode.y !== undefined;
}

function mergeSeries(
  option: Record<string, unknown>,
  options?: ChartPresentationOptions | null,
): void {
  const series = option.series;
  if (!Array.isArray(series)) {
    return;
  }
  const theme = resolveDashboardTheme(options?.colorThemeId, options?.designKitId);
  const styleId = options?.viewStyleId ?? DASHBOARD_VIEW_STYLE_ID_EMPHASIS;
  option.series = series.map((item) => {
    if (!isPlainObject(item)) {
      return item;
    }
    const type = item.type;
    if (type === "bar") {
      const currentName = typeof item.name === "string" ? item.name.toLowerCase() : "";
      const isCurrent = currentName.includes("current");
      const previousItemStyle = isPlainObject(item.itemStyle) ? item.itemStyle : {};
      const color = isCurrent ? theme.chart.current : theme.chart.primary;
      const baseColor =
        typeof previousItemStyle.color === "string" ? previousItemStyle.color : color;
      const isHorizontal = isHorizontalBarSeries(item);
      const radius = isHorizontal
        ? styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
          ? [0, 4, 4, 0]
          : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
            ? [0, 7, 7, 0]
            : [0, 8, 8, 0]
        : styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
          ? [4, 4, 0, 0]
          : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
            ? [7, 7, 0, 0]
            : [8, 8, 0, 0];
      const barMaxWidth = isHorizontal
        ? styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
          ? 16
          : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
            ? 20
            : 24
        : styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
          ? 38
          : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
            ? 46
            : 52;
      const barStyle =
        styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
          ? {
              color: baseColor,
              borderRadius: radius,
            }
          : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
            ? {
                color: makeLinearGradient(baseColor, theme.chart.primarySoft),
                borderRadius: radius,
                shadowBlur: 8,
                shadowColor: theme.chart.primarySoft,
              }
            : {
                color: baseColor,
                borderRadius: radius,
                shadowBlur: 12,
                shadowColor: theme.chart.currentSoft,
            };
      return {
        ...item,
        barMaxWidth,
        barCategoryGap:
          styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
            ? "52%"
            : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
              ? "44%"
              : "40%",
        showBackground: styleId !== DASHBOARD_VIEW_STYLE_ID_CLEAN,
        backgroundStyle: {
          color: theme.chart.track,
          borderRadius: radius,
          ...(isPlainObject(item.backgroundStyle) ? item.backgroundStyle : {}),
        },
        itemStyle: {
          ...barStyle,
          ...previousItemStyle,
          color:
            styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
              ? barStyle.color
              : previousItemStyle.color ?? barStyle.color,
          borderRadius: barStyle.borderRadius,
        },
      };
    }
    if (type === "line") {
      const previousLineStyle = isPlainObject(item.lineStyle) ? item.lineStyle : {};
      const lineColor = typeof previousLineStyle.color === "string"
        ? previousLineStyle.color
        : theme.chart.forecast;
      const areaStyle =
        styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
          ? { opacity: 0 }
          : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
            ? {
                opacity: 0.16,
                color: makeLinearGradient(
                  typeof lineColor === "string" ? lineColor : theme.chart.primary,
                  "transparent",
                ),
              }
            : {
                opacity: 0.2,
                color: makeLinearGradient(
                  typeof lineColor === "string" ? lineColor : theme.chart.primary,
                  "transparent",
                ),
              };
      return {
        ...item,
        smooth: styleId !== DASHBOARD_VIEW_STYLE_ID_CLEAN,
        symbolSize: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS ? 7 : 5,
        lineStyle: {
          ...previousLineStyle,
          width: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS ? 3 : 2,
        },
        areaStyle,
        emphasis: {
          focus: "series",
          ...(isPlainObject(item.emphasis) ? item.emphasis : {}),
        },
      };
    }
    if (type === "pie") {
      if (item.radius === undefined) {
        return { radius: ["40%", "65%"], ...item };
      }
      return item;
    }
    if (type === "funnel") {
      const previousItemStyle = isPlainObject(item.itemStyle) ? item.itemStyle : {};
      const funnelGap =
        styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
          ? 4
          : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
            ? 6
            : 8;
      const funnelShadowBlur =
        styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
          ? 0
          : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
            ? 7
            : 12;
      const funnelShadowColor =
        styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? undefined : theme.chart.currentSoft;
      return {
        ...item,
        gap: funnelGap,
        itemStyle: {
          ...previousItemStyle,
          shadowBlur: funnelShadowBlur,
          shadowColor: funnelShadowColor,
        },
      };
    }
    return item;
  });
}

function mergeGraphic(
  option: Record<string, unknown>,
  options?: ChartPresentationOptions | null,
): void {
  const graphic = option.graphic;
  if (!Array.isArray(graphic)) {
    return;
  }
  const styleId = options?.viewStyleId ?? DASHBOARD_VIEW_STYLE_ID_EMPHASIS;
  const theme = resolveDashboardTheme(options?.colorThemeId, options?.designKitId);
  option.graphic = graphic.map((entry, index) => {
    if (!isPlainObject(entry) || !isPlainObject(entry.style)) {
      return entry;
    }
    if (entry.type === "rect") {
      const rectStyle = entry.style;
      return {
        ...entry,
        style: {
          ...rectStyle,
          opacity:
            styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
              ? rectStyle.opacity ?? 0.82
              : rectStyle.opacity ?? 1,
          shadowBlur:
            styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS
              ? rectStyle.shadowBlur ?? 10
              : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
                ? rectStyle.shadowBlur ?? 6
                : rectStyle.shadowBlur,
          shadowColor:
            styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
              ? rectStyle.shadowColor
              : rectStyle.shadowColor ?? theme.chart.currentSoft,
        },
      };
    }
    const isTextElement = entry.type === "text" || typeof entry.style.text === "string";
    if (!isTextElement) {
      return entry;
    }
    const textStyle = entry.style;
    const isPrimaryValue = index === 1;
    const styleOverrides = isPrimaryValue
      ? {
          fontSize:
            styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
              ? 30
              : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
                ? 34
                : 36,
          lineHeight: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 36 : 40,
          fontWeight: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 650 : 750,
        }
      : {
          fontSize:
            styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS
              ? textStyle.fontSize ?? 13
              : textStyle.fontSize,
        };
    return {
      ...entry,
      style: {
        ...textStyle,
        ...styleOverrides,
      },
    };
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
    {
      colorThemeId: options?.colorThemeId,
      designKitId: options?.designKitId,
    },
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
  mergeSeries(option, options);
  mergeGraphic(option, options);
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
  const slotsById = new Map(input.slots.map((slot) => [slot.id, slot]));
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
  }, clone(input.template));

  const transformedOption = applyRendererTransforms({
    template: option,
    transforms: input.transforms ?? [],
    bindingResultsBySlotId,
  });

  return mergeResponsiveEChartsTemplate(transformedOption, input.presentation);
}
