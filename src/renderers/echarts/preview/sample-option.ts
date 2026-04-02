import type { DashboardRendererSlot, JsonValue } from "@/contracts";
import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import { formatRendererSlotValue } from "@/renderers/core/format-slot-value";
import {
  estimateValueCount,
  injectValueIntoTemplate,
} from "@/renderers/core/slot-path";

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

function createSampleArray(): JsonValue {
  return [120, 156, 194, 228, 260];
}

function createSampleRows(): JsonValue {
  return Array.from({ length: 5 }, (_, index) => ({
    label: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"][index],
    value: 120 + index * 36,
    date: `2026-03-${String(3 + index * 3).padStart(2, "0")}`,
  }));
}

function createSampleValueForSlot(slot: DashboardRendererSlot): JsonValue {
  const value = (() => {
  switch (slot.value_kind) {
    case "scalar":
      return createSampleScalar();
    case "object":
      return createSampleObject();
    case "array":
      return createSampleArray();
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
}): { option: EChartsOptionTemplate; rowsCount: number } {
  let option = clone(input.optionTemplate);
  let rowsCount = 0;

  input.slots.forEach((slot) => {
    const sampleValue = createSampleValueForSlot(slot);
    option = injectValueIntoTemplate(option, slot.path, sampleValue) as EChartsOptionTemplate;
    rowsCount += estimateValueCount(sampleValue);
  });

  return {
    option,
    rowsCount,
  };
}
