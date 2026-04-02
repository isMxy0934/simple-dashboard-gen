import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import type { RendererValidationCheck } from "@/renderers/core/validation-result";
import { mergeResponsiveEChartsTemplate } from "@/renderers/echarts/browser/materialize-option";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown renderer error";
}

export async function validateEChartsOptionInBrowser(
  optionTemplate: EChartsOptionTemplate,
): Promise<RendererValidationCheck> {
  if (Object.keys(optionTemplate).length === 0) {
    return {
      target: "browser",
      status: "error",
      reason: "Browser renderer validation failed.",
      message: "option_template is empty.",
    };
  }

  let host: HTMLDivElement | null = null;
  let chart:
    | {
        setOption: (option: unknown, notMerge?: boolean) => void;
        dispose: () => void;
      }
    | null = null;

  try {
    const echarts = await import("echarts");
    host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-10000px";
    host.style.top = "-10000px";
    host.style.width = "480px";
    host.style.height = "320px";
    host.style.pointerEvents = "none";
    host.style.opacity = "0";
    document.body.appendChild(host);

    chart = echarts.init(host, undefined, { renderer: "canvas" });
    chart.setOption(mergeResponsiveEChartsTemplate(optionTemplate) as never, true);

    return {
      target: "browser",
      status: "ok",
      reason: "Browser renderer validation passed.",
    };
  } catch (error) {
    return {
      target: "browser",
      status: "error",
      reason: "Browser renderer validation failed.",
      message: getErrorMessage(error),
    };
  } finally {
    chart?.dispose();
    host?.remove();
  }
}
