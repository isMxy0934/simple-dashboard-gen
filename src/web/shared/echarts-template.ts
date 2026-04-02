import type {
  BindingResult,
  DashboardRendererSlot,
  EChartsOptionTemplate,
  JsonObject,
  JsonValue,
} from "@/contracts";
import {
  estimateValueCount,
  getBindingResultValue,
  injectValueIntoOptionTemplate,
} from "@/domain/rendering/slot-injection";

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

function extractSeriesFieldNames(optionTemplate: EChartsOptionTemplate): string[] {
  const fields = new Set<string>();
  (optionTemplate.series ?? []).forEach((series) => {
    if (!series.encode) {
      return;
    }

    Object.values(series.encode).forEach((value) => {
      if (typeof value === "string") {
        fields.add(value);
        return;
      }

      value.forEach((field) => fields.add(field));
    });
  });

  return [...fields];
}

function buildPreviewRows(fields: string[]): Array<Record<string, JsonValue>> {
  if (fields.length === 0) {
    return [];
  }

  return Array.from({ length: 5 }, (_, index) => {
    const row: Record<string, JsonValue> = {};

    for (const field of fields) {
      row[field] = createSampleValue(field, index);
    }

    return row;
  });
}

function createSampleValue(field: string, index: number): JsonValue {
  const normalized = field.toLowerCase();

  if (normalized.includes("week") || normalized.includes("date")) {
    return `2026-03-${String(3 + index * 3).padStart(2, "0")}`;
  }

  if (normalized.includes("region")) {
    return ["East", "West", "South", "North", "Central"][index % 5];
  }

  if (normalized.includes("channel")) {
    return ["Organic", "Paid", "Partner", "Referral", "Direct"][index % 5];
  }

  if (
    normalized.includes("label") ||
    normalized.includes("name") ||
    normalized.includes("type") ||
    normalized.includes("category")
  ) {
    return ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"][index % 5];
  }

  return 120 + index * 36;
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

export function getTemplatePreviewOption(
  optionTemplate: EChartsOptionTemplate,
): { option: EChartsOptionTemplate; rowsCount: number } {
  const option = clone(optionTemplate);
  const rows = buildPreviewRows(extractSeriesFieldNames(optionTemplate));

  option.dataset = {
    ...(option.dataset ?? {}),
    source: rows,
  } as Record<string, JsonValue>;

  return {
    option,
    rowsCount: rows.length,
  };
}

export function injectBindingResultIntoOptionTemplate(
  template: EChartsOptionTemplate,
  slot: DashboardRendererSlot,
  bindingResult: BindingResult | undefined,
): EChartsOptionTemplate {
  const value = getBindingResultValue(bindingResult);
  if (value === undefined) {
    return clone(template);
  }

  return injectValueIntoOptionTemplate(template, slot.path, value);
}

export function isOptionTemplateEmpty(bindingResult: BindingResult | undefined): boolean {
  if (!bindingResult || bindingResult.status === "error") {
    return true;
  }

  return estimateValueCount(bindingResult.data.value) === 0;
}
