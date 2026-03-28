import type {
  BindingResult,
  BindingResults,
  DashboardView,
  EChartsOptionTemplate,
  JsonObject,
  JsonValue,
} from "../../contracts";

export type ViewRenderStatus = "loading" | "ok" | "empty" | "error";

export interface RenderedView {
  view: DashboardView;
  bindingId?: string;
  status: ViewRenderStatus;
  message?: string;
  optionTemplate: EChartsOptionTemplate;
  rows: Array<Record<string, JsonValue>>;
}

export function deriveRenderedViews(
  views: DashboardView[],
  bindings: BindingResults,
  statusMap: Record<string, ViewRenderStatus>,
): RenderedView[] {
  return views.map((view) => {
    const bindingEntry = findBindingForView(bindings, view.id);
    const optionTemplate = cloneOptionTemplate(view.option_template);
    const rows = bindingEntry?.status === "ok" || bindingEntry?.status === "empty"
      ? bindingEntry.data.rows
      : [];

    if (rows.length > 0) {
      optionTemplate.dataset = {
        ...(optionTemplate.dataset ?? {}),
        source: rows,
      } as JsonObject;
    }

    return {
      view,
      bindingId: bindingEntry ? bindingEntry.bindingId : undefined,
      status: statusMap[view.id] ?? "loading",
      message:
        bindingEntry?.status === "error"
          ? bindingEntry.message ?? bindingEntry.code ?? "Unknown error"
          : bindingEntry?.status === "empty"
            ? "No rows were returned for this filter."
            : undefined,
      optionTemplate,
      rows: rows as Array<Record<string, JsonValue>>,
    };
  });
}

export function findBindingForView(
  bindings: BindingResults,
  viewId: string,
): (BindingResult & { bindingId: string }) | undefined {
  for (const [bindingId, result] of Object.entries(bindings)) {
    if (result.view_id === viewId) {
      return {
        ...result,
        bindingId,
      } as BindingResult & { bindingId: string };
    }
  }

  return undefined;
}

export function cloneOptionTemplate<T extends EChartsOptionTemplate>(template: T): T {
  return JSON.parse(JSON.stringify(template)) as T;
}

export function extractSeriesFieldNames(optionTemplate: EChartsOptionTemplate): string[] {
  const fields = new Set<string>();
  optionTemplate.series.forEach((series) => {
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
