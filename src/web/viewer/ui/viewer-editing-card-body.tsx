"use client";

import type {
  Binding,
  BindingResults,
  DashboardView,
} from "../../../contracts";
import { createMockValueForSlot, getBindingMode } from "../../../domain/dashboard/bindings";
import {
  getViewOptionTemplate,
  getViewSlots,
} from "../../../domain/dashboard/contract-kernel";
import { estimateValueCount } from "../../../renderers/core/slot-path";
import {
  summarizeRendererValidationChecks,
  type RendererChecksByView,
} from "../../../renderers/core/validation-result";
import { materializeEChartsOptionTemplate } from "../../../renderers/echarts/browser/materialize-option";
import { getTemplatePreviewOption } from "../../../renderers/echarts/preview/sample-option";
import type { ChartPresentationOptions } from "../../../presentation/dashboard/presentation-context";
import type { TranslateFn } from "../../i18n";
import type { RenderedView } from "../state/rendered-views";
import type { EditingPreviewState } from "./viewer-dashboard-types";
import { ViewerChart } from "./viewer-chart";
import { EmptyState, ErrorState, LoadingState } from "./viewer-dashboard-states";

export function EditingCardBody({
  view,
  bindings,
  previewResults,
  rendererCheck,
  previewState,
  hasDataDraft,
  renderedView,
  t,
  showChartMeta,
  chartPresentation,
}: {
  view: DashboardView;
  bindings: Binding[];
  previewResults: BindingResults;
  rendererCheck: RendererChecksByView[string] | undefined;
  previewState: EditingPreviewState;
  hasDataDraft: boolean;
  renderedView: RenderedView;
  t: TranslateFn;
  showChartMeta: boolean;
  chartPresentation: ChartPresentationOptions;
}) {
  const slots = getViewSlots(view);
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]));
  const rendererSummary = summarizeRendererValidationChecks(rendererCheck);
  const mockBindings = bindings.filter((binding) => getBindingMode(binding) === "mock");
  const liveBindings = bindings.filter((binding) => getBindingMode(binding) !== "mock");
  const bindingResultEntries = bindings.flatMap((binding) => {
    const result = previewResults[binding.id];
    return result ? [{ binding, result }] : [];
  });
  const bindingErrorEntry = bindingResultEntries.find(
    (entry) => entry.result.status === "error",
  );

  if (rendererSummary.status === "error") {
    return <ErrorState message={rendererSummary.reason} t={t} />;
  }

  if (bindingErrorEntry?.result.status === "error") {
    return (
      <ErrorState
        message={
          bindingErrorEntry.result.message ??
          bindingErrorEntry.result.code ??
          t("authoring.canvas.unknownPreviewError")
        }
        t={t}
      />
    );
  }

  if (bindings.length === 0 && !hasDataDraft) {
    const preview = getTemplatePreviewOption({
      optionTemplate: getViewOptionTemplate(view),
      slots: view.renderer.slots,
      transforms: view.renderer.transforms,
      presentation: chartPresentation,
    });
    return (
      <ViewerChart
        option={preview.option}
        rowsCount={preview.rowsCount}
        showMeta={showChartMeta}
      />
    );
  }

  if (bindings.length === 0) {
    return <EmptyState message={t("authoring.canvas.mockOnlyState")} t={t} />;
  }

  if (previewState === "loading" && liveBindings.length > 0) {
    return <LoadingState t={t} />;
  }

  const missingLiveBindingResult = liveBindings.find(
    (binding) => !previewResults[binding.id],
  );
  if (missingLiveBindingResult) {
    return <EmptyState message={t("authoring.canvas.boundNeedsCheckState")} t={t} />;
  }

  if (mockBindings.length > 0) {
    const liveResultEntries = liveBindings.flatMap((binding) => {
      const result = previewResults[binding.id];
      return result && result.status !== "error"
        ? [{ slot_id: result.slot_id, result }]
        : [];
    });
    const mockResultEntries = mockBindings.flatMap((binding) => {
      const slot = slotsById.get(binding.slot_id) ?? slots[0];
      if (!slot) {
        return [];
      }
      const mockRows = binding.mock_data?.rows ?? [];
      const mockValue =
        binding.mock_value ?? createMockValueForSlot(slot.value_kind, mockRows);
      const mockValueCount = estimateValueCount(mockValue);
      const mockBindingResult: BindingResults[string] = {
        view_id: view.id,
        slot_id: slot.id,
        query_id: "__mock__",
        status: mockValueCount === 0 ? "empty" : "ok",
        data: {
          value: mockValue,
          rows: mockRows,
        },
      };

      return [{
        slot_id: slot.id,
        result: mockBindingResult,
        valueCount: mockValueCount,
      }];
    });
    const materializedBindingResults = [
      ...liveResultEntries,
      ...mockResultEntries.map(({ slot_id, result }) => ({ slot_id, result })),
    ];
    const rowsCount = Math.max(
      0,
      ...liveResultEntries.map((entry) =>
        estimateValueCount(entry.result.data.value),
      ),
      ...mockResultEntries.map((entry) => entry.valueCount),
    );

    return (
      <ViewerChart
        option={materializeEChartsOptionTemplate({
          template: getViewOptionTemplate(view),
          slots: view.renderer.slots,
          transforms: view.renderer.transforms,
          presentation: chartPresentation,
          bindingResults: materializedBindingResults,
        })}
        rowsCount={rowsCount}
        showMeta={showChartMeta}
      />
    );
  }

  if (renderedView.status === "error") {
    return (
      <ErrorState
        message={renderedView.message ?? t("viewer.dashboard.batchRequestFailed")}
        t={t}
      />
    );
  }

  if (renderedView.status === "empty" || renderedView.dataCount === 0) {
    return <EmptyState message={t("authoring.canvas.noDataState")} t={t} />;
  }

  return (
    <ViewerChart
      option={renderedView.option}
      rowsCount={renderedView.dataCount}
      showMeta={showChartMeta}
    />
  );
}
