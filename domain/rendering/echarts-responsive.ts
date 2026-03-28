import type { EChartsOptionTemplate, JsonObject } from "../../contracts";

/**
 * ECharts 在卡片内渲染时的默认增强：限制柱宽、收紧 grid、轴标签防叠、tooltip 不溢出。
 * 模板字段仍优先生效（浅合并），避免破坏已有看板。
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DEFAULT_GRID: JsonObject = {
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
  const tt = option.tooltip;
  if (!isPlainObject(tt)) {
    option.tooltip = { confine: true };
    return;
  }
  option.tooltip = { confine: true, ...tt };
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
  const prevLabel = isPlainObject(axis.axisLabel) ? axis.axisLabel : {};
  return {
    ...axis,
    axisLabel: {
      hideOverlap: true,
      margin: key === "yAxis" ? 10 : 8,
      ...prevLabel,
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
  } else {
    option[key] = wrapAxis(axis, key);
  }
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
