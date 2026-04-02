import type {
  BindingResults,
  DashboardDocument,
} from "@/contracts";
import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import type {
  RendererChecksByView,
  RendererValidationCheck,
} from "@/renderers/core/validation-result";
import {
  materializeEChartsOptionTemplate,
  mergeResponsiveEChartsTemplate,
} from "@/renderers/echarts/browser/materialize-option";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown renderer error";
}

export async function validateEChartsOptionOnServer(
  optionTemplate: EChartsOptionTemplate,
): Promise<RendererValidationCheck> {
  if (Object.keys(optionTemplate).length === 0) {
    return {
      target: "server",
      status: "error",
      reason: "Server renderer validation failed.",
      message: "option_template is empty.",
    };
  }

  try {
    const echarts = await import("echarts");
    const instance = echarts.init(null as never, undefined, {
      renderer: "svg",
      ssr: true,
      width: 480,
      height: 320,
    });
    instance.setOption(mergeResponsiveEChartsTemplate(optionTemplate) as never, true);
    if (typeof (instance as { renderToSVGString?: () => string }).renderToSVGString === "function") {
      (instance as { renderToSVGString: () => string }).renderToSVGString();
    }
    instance.dispose();

    return {
      target: "server",
      status: "ok",
      reason: "Server renderer validation passed.",
    };
  } catch (error) {
    return {
      target: "server",
      status: "error",
      reason: "Server renderer validation failed.",
      message: getErrorMessage(error),
    };
  }
}

export async function validateEChartsViewsOnServer(input: {
  document: DashboardDocument;
  bindingResults: BindingResults;
  visibleViewIds: string[];
}): Promise<RendererChecksByView> {
  const viewIds =
    input.visibleViewIds.length > 0
      ? input.visibleViewIds
      : input.document.dashboard_spec.views.map((view) => view.id);
  const result: RendererChecksByView = {};

  for (const viewId of viewIds) {
    const view = input.document.dashboard_spec.views.find((candidate) => candidate.id === viewId);
    if (!view) {
      continue;
    }

    const bindingResults = Object.values(input.bindingResults)
      .filter((bindingResult) => bindingResult.view_id === viewId)
      .map((bindingResult) => ({
        slot_id: bindingResult.slot_id,
        result: bindingResult,
      }));
    const materializedOption = materializeEChartsOptionTemplate({
      template: view.renderer.option_template,
      slots: view.renderer.slots,
      bindingResults,
    });

    result[viewId] = {
      server: await validateEChartsOptionOnServer(materializedOption),
    };
  }

  return result;
}
