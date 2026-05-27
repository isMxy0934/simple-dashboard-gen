import type {
  BindingResults,
  DashboardDocument,
  DashboardRenderer,
  JsonObject,
} from "@/contracts";
import { EXECUTIVE_REPORT_DESIGN_KIT_ID } from "@/contracts/dashboard-presentation";
import { getRecipePolicyRejection } from "@/contracts/dashboard-recipe-policy";
import { resolveViewPresentationContext } from "@/presentation/dashboard/presentation-context";
import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import type {
  RendererChecksByView,
  RendererValidationCheck,
} from "@/renderers/core/validation-result";
import { materializeEChartsOptionTemplate } from "@/renderers/echarts/browser/materialize-option";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown renderer error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getGraphicTextValues(optionTemplate: JsonObject): string[] {
  const graphic = optionTemplate.graphic;
  if (!Array.isArray(graphic)) {
    return [];
  }
  return graphic.flatMap((entry) => {
    if (!isRecord(entry) || entry.type !== "text" || !isRecord(entry.style)) {
      return [];
    }
    return typeof entry.style.text === "string" ? [entry.style.text] : [];
  });
}

function validatePresentationContract(input: {
  document: DashboardDocument;
  viewId: string;
  renderer: DashboardRenderer;
}): RendererValidationCheck {
  const view = input.document.dashboard_spec.views.find((candidate) => candidate.id === input.viewId);
  const presentation = resolveViewPresentationContext(input.document, {
    viewId: input.viewId,
  });
  const rejection = getRecipePolicyRejection(
    presentation.designKit.id,
    input.renderer.recipe_id ?? "",
  );
  if (rejection) {
    return {
      target: "presentation",
      status: "error",
      reason: "Renderer violates the active design kit policy.",
      message:
        `${input.renderer.recipe_id} is not supported for ${presentation.designKit.id}.` +
        (rejection.recommendedRecipeId
          ? ` Rebuild this view with ${rejection.recommendedRecipeId}.`
          : ""),
    };
  }

  if (presentation.designKit.id === EXECUTIVE_REPORT_DESIGN_KIT_ID && view) {
    const shellTexts = [view.title, view.description].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    const graphicTexts = getGraphicTextValues(input.renderer.option_template);
    if (graphicTexts.some((text) => shellTexts.includes(text))) {
      return {
        target: "presentation",
        status: "error",
        reason: "Renderer duplicates shell chrome.",
        message:
          "executive_report recipe body must not duplicate shell title or description. Rebuild this view.",
      };
    }
  }

  return {
    target: "presentation",
    status: "ok",
    reason: "Renderer presentation contract passed.",
  };
}

/**
 * Validates a fully materialized ECharts option. Callers that start from a
 * dashboard renderer template must inject bindings and resolve presentation
 * refs before calling this function.
 */
export async function validateEChartsOptionOnServer(
  option: EChartsOptionTemplate,
): Promise<RendererValidationCheck> {
  if (Object.keys(option).length === 0) {
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
    instance.setOption(option as never, true);
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
    const { chartPresentation } = resolveViewPresentationContext(input.document, { viewId });

    const bindingResults = Object.values(input.bindingResults)
      .filter((bindingResult) => bindingResult.view_id === viewId)
      .map((bindingResult) => ({
        slot_id: bindingResult.slot_id,
        result: bindingResult,
      }));
    const materializedOption = materializeEChartsOptionTemplate({
      template: view.renderer.option_template,
      slots: view.renderer.slots,
      transforms: view.renderer.transforms,
      presentation: chartPresentation,
      bindingResults,
    });

    result[viewId] = {
      presentation: validatePresentationContract({
        document: input.document,
        viewId,
        renderer: view.renderer,
      }),
      server: await validateEChartsOptionOnServer(materializedOption),
    };
  }

  return result;
}
