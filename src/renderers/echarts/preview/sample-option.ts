import type {
  BindingResult,
  BindingRow,
  DashboardRendererSlot,
  DashboardRendererTransform,
  JsonValue,
} from "@/contracts";
import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import { formatRendererSlotValue } from "@/renderers/core/format-slot-value";
import { estimateValueCount } from "@/renderers/core/slot-path";
import {
  materializeEChartsOptionTemplate,
  type MergeResponsiveEChartsTemplateOptions,
} from "@/renderers/echarts/browser/materialize-option";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createSampleScalar(): JsonValue {
  return 156;
}

function createSampleObject(): JsonValue {
  return {
    label: "Alpha",
    value: 156,
  };
}

const SAMPLE_DATES = [
  "2026/3/16",
  "2026/3/23",
  "2026/3/30",
  "2026/4/6",
  "2026/4/13",
  "2026/4/20",
  "2026/4/27",
  "2026/5/4",
  "2026/5/11",
];

const SAMPLE_CATEGORIES = [
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Epsilon",
  "Zeta",
  "Eta",
  "Theta",
  "Iota",
];
const SAMPLE_NUMBERS = [120, 156, 194, 228, 260, 232, 276, 310, 348];

function slotLooksLikeDate(slot: DashboardRendererSlot): boolean {
  return /date|time|week|month|day/i.test(`${slot.id} ${slot.path}`);
}

function slotLooksLikeCategory(slot: DashboardRendererSlot): boolean {
  return /category|label|name/i.test(`${slot.id} ${slot.path}`);
}

function createSampleArray(slot: DashboardRendererSlot): JsonValue {
  if (slotLooksLikeDate(slot)) {
    return SAMPLE_DATES;
  }

  if (slotLooksLikeCategory(slot)) {
    return SAMPLE_CATEGORIES;
  }

  return SAMPLE_NUMBERS;
}

function createSampleRows(): BindingRow[] {
  return SAMPLE_DATES.flatMap((date, index) => [
    {
      label: "Series A",
      category_name: SAMPLE_CATEGORIES[index] ?? `Category ${index + 1}`,
      value: 120 + index * 18,
      date,
      time_value: date,
      series_value: "Series A",
      metric_value: 120 + index * 18,
    },
    {
      label: "Series B",
      category_name: SAMPLE_CATEGORIES[index] ?? `Category ${index + 1}`,
      value: 72 + index * 12,
      date,
      time_value: date,
      series_value: "Series B",
      metric_value: 72 + index * 12,
    },
  ]);
}

function createSampleValueForSlot(slot: DashboardRendererSlot): JsonValue {
  const value = (() => {
    switch (slot.value_kind) {
      case "scalar":
        return createSampleScalar();
      case "object":
        return createSampleObject();
      case "array":
        return createSampleArray(slot);
      case "rows":
      default:
        return createSampleRows();
    }
  })();

  return formatRendererSlotValue(value, slot.formatter);
}

export function getTemplatePreviewOption(input: {
  optionTemplate: EChartsOptionTemplate;
  slots: DashboardRendererSlot[];
  transforms?: DashboardRendererTransform[];
  presentation?: MergeResponsiveEChartsTemplateOptions | null;
}): { option: EChartsOptionTemplate; rowsCount: number } {
  let rowsCount = 0;
  const bindingResults = input.slots.map((slot) => {
    const sampleValue = createSampleValueForSlot(slot);
    const valueCount = estimateValueCount(sampleValue);
    rowsCount = Math.max(rowsCount, valueCount);
    return {
      slot_id: slot.id,
      result: {
        view_id: "__template_preview__",
        slot_id: slot.id,
        query_id: "__template_preview__",
        status: valueCount === 0 ? "empty" : "ok",
        data: {
          value: sampleValue,
          rows:
            slot.value_kind === "rows"
              ? (sampleValue as BindingRow[])
              : undefined,
        },
      } satisfies BindingResult,
    };
  });

  return {
    option: materializeEChartsOptionTemplate({
      template: clone(input.optionTemplate),
      slots: input.slots,
      transforms: input.transforms,
      presentation: input.presentation,
      bindingResults,
    }),
    rowsCount,
  };
}
