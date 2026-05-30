import type {
  Binding,
  DashboardDocument,
  DashboardLayoutItem,
  DatasourceContext,
} from "@/contracts";
import type {
  DraftStatusToolOutput,
  StageChartToolInput,
  StageReplaceChartToolInput,
  StageReplaceChartToolOutput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import { defineTool } from "@/ai/authoring/tools/definition";
import { stageReplaceChartInputSchema } from "@/ai/authoring/tools/schemas";
import type { WorkingDraftState } from "@/ai/authoring/tools/draft-state";
import { resolveRequiredView } from "@/ai/authoring/tools/detail-builders";
import {
  getLayoutItemsForView,
  removeQueryFromDocument,
  removeViewFromDocument,
} from "@/domain/dashboard/document";
import { isLiveBinding } from "@/domain/dashboard/bindings";
import { stableHash } from "@/ai/authoring/tools/stage-chart-resolve";
import { stageChartTransaction } from "@/ai/authoring/tools/stage-chart-tool";

const STAGE_REPLACE_CHART_TOOL_DESCRIPTION = [
  "Internal compatibility helper for staging one atomic replacement transaction for an existing compiled chart.",
  "Model-facing delete-and-rebuild or redo flows should use stageViewIntent with the revised semantic view intent.",
  "The runtime removes the target view and its private bindings/queries, then creates the replacement chart in the same working draft.",
  "The replacement reuses the original view id and layout position so selection and user context stay stable.",
].join(" ");

function layoutOverrideFromItem(
  item: DashboardLayoutItem | undefined,
): Partial<DashboardLayoutItem> | undefined {
  if (!item) {
    return undefined;
  }
  return {
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
  };
}

function liveQueryIdsForBindings(bindings: Binding[]): string[] {
  return [
    ...new Set(
      bindings
        .filter((binding) => isLiveBinding(binding))
        .map((binding) => binding.query_id),
    ),
  ];
}

export function buildStageReplaceChartTool(input: {
  dashboard: DashboardDocument;
  checks?: ViewCheckSnapshot[] | null;
  focusedViewId: string | null;
  workingDraft: WorkingDraftState;
  getActiveGoalId?: () => string | null | undefined;
  markWorkingDraftUpdated: () => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
  buildDraftStatus: () => DraftStatusToolOutput;
  getDatasourceSchema: (datasourceId: string) => Promise<DatasourceContext>;
}) {
  return defineTool({
    name: "stageReplaceChart",
    label: "Stage Replace Chart",
    description: STAGE_REPLACE_CHART_TOOL_DESCRIPTION,
    contract: {
      parameters: [
        "Provide replace_view_id plus the compiled chart intent fields.",
        "Do not provide target_view_id; the replacement always reuses replace_view_id.",
      ],
      prohibited: [
        "SQL, QueryDef.output, renderer.option_template, renderer slots, binding ids, and layout defaults; runtime owns these.",
        "Do not call stageDelete first for replacement work.",
      ],
      preconditions: [
        "Use only when replacing an existing chart, especially for delete-and-rebuild requests.",
        "In focused scope, replace_view_id must be the focused view id.",
      ],
    },
    parameters: stageReplaceChartInputSchema,
    executionMode: "sequential",
    execute: async (
      toolInput: StageReplaceChartToolInput,
    ): Promise<StageReplaceChartToolOutput> => {
      const beforeDocument = input.buildCandidateDocument(
        input.dashboard,
        input.workingDraft,
      );
      const replaceViewId = toolInput.replace_view_id;
      if (input.focusedViewId && replaceViewId !== input.focusedViewId) {
        throw new Error(
          `Focused replacement can only replace the selected view "${input.focusedViewId}".`,
        );
      }

      const replacedView = resolveRequiredView(beforeDocument, replaceViewId);
      const oldLayout = getLayoutItemsForView(beforeDocument, replaceViewId);
      const removedBindings = beforeDocument.bindings.filter(
        (binding) => binding.view_id === replaceViewId,
      );
      const removedBindingIds = removedBindings.map((binding) => binding.id);
      const privateQueryIds = liveQueryIdsForBindings(removedBindings).filter(
        (queryId) =>
          !beforeDocument.bindings.some(
            (binding) =>
              binding.view_id !== replaceViewId &&
              isLiveBinding(binding) &&
              binding.query_id === queryId,
          ),
      );

      let replacementBase = removeViewFromDocument(beforeDocument, replaceViewId);
      for (const queryId of privateQueryIds) {
        replacementBase = removeQueryFromDocument(replacementBase, queryId);
      }

      const { replace_view_id: _replaceViewId, ...chartIntent } = toolInput;
      const replacementInput: StageChartToolInput = {
        ...chartIntent,
        target_view_id: replaceViewId,
        layout: {
          desktop:
            toolInput.layout?.desktop ?? layoutOverrideFromItem(oldLayout.desktop),
          mobile: toolInput.layout?.mobile ?? layoutOverrideFromItem(oldLayout.mobile),
        },
      };

      const result = await stageChartTransaction({
        ...input,
        toolInput: replacementInput,
        baseDocument: replacementBase,
        forcedViewId: replaceViewId,
        preserveLayoutY: true,
      });

      input.workingDraft.dirtyViewIds.add(replaceViewId);
      for (const queryId of privateQueryIds) {
        input.workingDraft.dirtyQueryIds.add(queryId);
      }
      for (const bindingId of removedBindingIds) {
        input.workingDraft.dirtyBindingIds.add(bindingId);
      }
      input.markWorkingDraftUpdated();

      const draftStatus = input.buildDraftStatus();
      return {
        ...result.output,
        summary: `Staged replacement for view "${replacedView.title}" as "${result.output.view.view.title}".`,
        transaction_id: `txn_replace_${stableHash(
          `${replaceViewId}|${result.query?.id ?? "mock"}|${toolInput.skill_id}`,
        )}`,
        artifact_ids: {
          replaced_view_id: replaceViewId,
          removed_view_ids: [replaceViewId],
          removed_query_ids: privateQueryIds,
          removed_binding_ids: removedBindingIds,
          view_id: result.viewId,
          ...(result.query ? { query_id: result.query.id } : {}),
          binding_ids: result.bindings.map((binding) => binding.id),
        },
        blockers: draftStatus.blockers,
        draft_status: draftStatus,
      };
    },
  });
}
