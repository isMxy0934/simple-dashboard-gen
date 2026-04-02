import type { BindingResult, DashboardRendererSlot } from "@/contracts";
import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import {
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

export function injectBindingResultIntoEChartsOptionTemplate(
  template: EChartsOptionTemplate,
  slot: DashboardRendererSlot,
  bindingResult: BindingResult | undefined,
): EChartsOptionTemplate {
  const value = getBindingResultValue(bindingResult);
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
