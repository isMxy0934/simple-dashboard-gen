import type { BindingResult, DashboardRendererSlot, EChartsOptionTemplate } from "../../contracts";
import {
  estimateValueCount,
  getBindingResultValue,
  injectValueIntoOptionTemplate,
} from "./slot-injection";

export function injectBindingResultIntoOptionTemplate(
  template: EChartsOptionTemplate,
  slot: DashboardRendererSlot,
  bindingResult: BindingResult | undefined,
): EChartsOptionTemplate {
  const value = getBindingResultValue(bindingResult);
  if (value === undefined) {
    return JSON.parse(JSON.stringify(template)) as EChartsOptionTemplate;
  }

  return injectValueIntoOptionTemplate(template, slot.path, value);
}

export function isOptionTemplateEmpty(bindingResult: BindingResult | undefined): boolean {
  if (!bindingResult || bindingResult.status === "error") {
    return true;
  }

  return estimateValueCount(bindingResult.data.value) === 0;
}
