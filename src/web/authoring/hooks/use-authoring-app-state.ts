"use client";

import { useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { isLiveBinding } from "../../../domain/dashboard/bindings";
import {
  getQueryOutput,
  getViewOptionTemplate,
} from "../../../domain/dashboard/contract-kernel";
import { getBindingsForView } from "../../../domain/dashboard/document";
import type { AuthoringRoute } from "@/ai/authoring/contracts/route";
import type { AuthoringWorkflowSummary } from "@/ai/authoring/contracts/tool-io";
import type { AuthoringTaskStatus } from "@/ai/authoring/contracts/task-event";
import { summarizeContractState } from "@/ai/authoring/messages/context-summary";
import { getAuthoringLayout } from "./use-authoring-controller";
import { useI18n } from "../../i18n/i18n-context";
import type { TranslateFn } from "../../i18n";
import type {
  BindingResults,
  DashboardDocument,
} from "@/contracts";

interface ValidationIssue {
  path: string;
  message: string;
}

interface FocusedViewProgress {
  title: string;
  steps: Array<{
    id: "appearance" | "query" | "binding" | "verified";
    done: boolean;
  }>;
}

interface UseAuthoringAppStateInput {
  breakpoint: "desktop" | "mobile";
  dashboard: DashboardDocument;
  previewResults: BindingResults;
  validationIssues: ValidationIssue[];
  selectedViewId: string | null;
  selectedQueryId: string | null;
  authoringTaskIntervention:
    | {
        active: boolean;
        kind: "layout" | "contract";
        viewId?: string | null;
      }
    | null
    | undefined;
  authoringRoute: AuthoringRoute | null;
  authoringWorkflow: AuthoringWorkflowSummary | null;
  pendingApproval: boolean;
  setSelectedQueryId: Dispatch<SetStateAction<string | null>>;
  setTemplateInput: Dispatch<SetStateAction<string>>;
  setTemplateError: Dispatch<SetStateAction<string | null>>;
  setQueryParamsInput: Dispatch<SetStateAction<string>>;
  setQuerySchemaInput: Dispatch<SetStateAction<string>>;
  setQueryError: Dispatch<SetStateAction<string | null>>;
  setAdvancedMode: Dispatch<SetStateAction<boolean>>;
  setSelectedViewId: Dispatch<SetStateAction<string | null>>;
}

export function useAuthoringAppState({
  breakpoint,
  dashboard,
  previewResults,
  validationIssues,
  selectedViewId,
  selectedQueryId,
  authoringTaskIntervention,
  authoringRoute,
  authoringWorkflow,
  pendingApproval,
  setSelectedQueryId,
  setTemplateInput,
  setTemplateError,
  setQueryParamsInput,
  setQuerySchemaInput,
  setQueryError,
  setAdvancedMode,
  setSelectedViewId,
}: UseAuthoringAppStateInput) {
  const { t } = useI18n();
  const activeLayout = getAuthoringLayout(dashboard, breakpoint);
  const viewMap = useMemo(
    () => new Map(dashboard.dashboard_spec.views.map((view) => [view.id, view])),
    [dashboard.dashboard_spec.views],
  );
  const selectedView = selectedViewId
    ? dashboard.dashboard_spec.views.find((view) => view.id === selectedViewId) ?? null
    : null;
  const selectedBinding = selectedView
    ? getBindingsForView(dashboard, selectedView.id)[0]
    : undefined;
  const selectedQuery = dashboard.query_defs.find(
    (query) =>
      query.id ===
      (isLiveBinding(selectedBinding) ? selectedBinding.query_id : selectedQueryId),
  );
  const selectedBindingResult = selectedBinding
    ? previewResults[selectedBinding.id]
    : undefined;
  const selectedViewIndex = selectedView
    ? dashboard.dashboard_spec.views.findIndex((view) => view.id === selectedView.id)
    : -1;
  const selectedBindingIndex = selectedBinding
    ? dashboard.bindings.findIndex((binding) => binding.id === selectedBinding.id)
    : -1;
  const selectedQueryIndex = selectedQuery
    ? dashboard.query_defs.findIndex((query) => query.id === selectedQuery.id)
    : -1;
  const contractStateSummary = useMemo(
    () => summarizeContractState(dashboard),
    [dashboard],
  );
  const hasDataDraft =
    dashboard.query_defs.length > 0 || dashboard.bindings.length > 0;
  const focusedViewProgress = useMemo<FocusedViewProgress | null>(() => {
    if (!selectedView) {
      return null;
    }

    const hasAppearance =
      Boolean(selectedView.renderer.option_template) &&
      Object.keys(selectedView.renderer.option_template).length > 0;
    const hasQuery = Boolean(selectedQuery);
    const hasBinding = Boolean(selectedBinding);
    const isVerified =
      selectedBindingResult?.status === "ok" || selectedBindingResult?.status === "empty";

    return {
      title: selectedView.title,
      steps: [
        { id: "appearance", done: hasAppearance },
        { id: "query", done: hasQuery },
        { id: "binding", done: hasBinding },
        { id: "verified", done: isVerified },
      ],
    };
  }, [selectedBinding, selectedBindingResult?.status, selectedQuery, selectedView]);

  const selectedIssues = useMemo(() => {
    if (!selectedView) {
      return validationIssues;
    }

    const bindingId = selectedBinding?.id;
    const queryId = selectedQuery?.id;
    return validationIssues.filter((issue) => {
      return (
        (selectedViewIndex >= 0 &&
          issue.path.startsWith(`dashboard_spec.views[${selectedViewIndex}]`)) ||
        (selectedBindingIndex >= 0 &&
          issue.path.startsWith(`bindings[${selectedBindingIndex}]`)) ||
        (selectedQueryIndex >= 0 &&
          issue.path.startsWith(`query_defs[${selectedQueryIndex}]`)) ||
        issue.path.includes(selectedView.id) ||
        Boolean(bindingId && issue.path.includes(bindingId)) ||
        Boolean(queryId && issue.path.includes(queryId))
      );
    });
  }, [
    selectedBinding?.id,
    selectedBindingIndex,
    selectedQuery?.id,
    selectedQueryIndex,
    selectedView,
    selectedViewIndex,
    validationIssues,
  ]);

  useEffect(() => {
    if (!selectedView) {
      setTemplateInput("");
      setTemplateError(null);
      return;
    }

    setTemplateInput(JSON.stringify(getViewOptionTemplate(selectedView), null, 2));
    setTemplateError(null);
  }, [selectedView, setTemplateError, setTemplateInput]);

  useEffect(() => {
    if (!selectedView) {
      setSelectedQueryId(dashboard.query_defs[0]?.id ?? null);
      return;
    }

    if (isLiveBinding(selectedBinding)) {
      setSelectedQueryId(selectedBinding.query_id ?? null);
      return;
    }

    setSelectedQueryId((current) => {
      if (current && dashboard.query_defs.some((query) => query.id === current)) {
        return current;
      }
      return dashboard.query_defs[0]?.id ?? null;
    });
  }, [dashboard.query_defs, selectedBinding, selectedView, setSelectedQueryId]);

  useEffect(() => {
    if (!selectedQuery) {
      setQueryParamsInput("[]");
      setQuerySchemaInput("[]");
      setQueryError(null);
      return;
    }

    setQueryParamsInput(JSON.stringify(selectedQuery.params, null, 2));
    setQuerySchemaInput(JSON.stringify(getQueryOutput(selectedQuery), null, 2));
    setQueryError(null);
  }, [selectedQuery, setQueryError, setQueryParamsInput, setQuerySchemaInput]);

  useEffect(() => {
    const intervention = authoringTaskIntervention;
    if (!intervention?.active || intervention.kind !== "contract") {
      return;
    }

    setAdvancedMode(true);
    if (intervention.viewId) {
      setSelectedViewId(intervention.viewId);
    }
  }, [
    authoringTaskIntervention?.active,
    authoringTaskIntervention?.kind,
    authoringTaskIntervention?.viewId,
    setAdvancedMode,
    setSelectedViewId,
  ]);

  const agentGuidance = useMemo(
    () => getAgentGuidance(dashboard, selectedView?.title ?? null, t),
    [dashboard, selectedView?.title, t],
  );
  const baselineTaskStatus = useMemo(
    () =>
      resolveAuthoringTaskStatus({
        route: authoringRoute ?? "chat",
        activeStage: deriveWorkspaceStage({
          authoringRoute,
          authoringWorkflow,
          pendingApproval,
        }),
        pendingApproval,
      }),
    [authoringRoute, authoringWorkflow, pendingApproval],
  );

  return {
    activeLayout,
    viewMap,
    selectedView,
    selectedBinding,
    selectedQuery,
    selectedBindingResult,
    selectedIssues,
    hasDataDraft,
    focusedViewProgress,
    contractStateSummary,
    agentGuidance,
    baselineTaskStatus,
  };
}

function resolveAuthoringTaskStatus(input: {
  route: "authoring" | "approval" | "chat";
  activeStage: "chat" | "explore" | "author" | "approval";
  pendingApproval: boolean;
}): AuthoringTaskStatus {
  if (input.pendingApproval || input.route === "approval") {
    return "awaiting_approval";
  }

  switch (input.activeStage) {
    case "approval":
      return "reviewing";
    case "explore":
    case "author":
      return input.route === "authoring" ? "authoring" : "idle";
    case "chat":
    default:
      return input.route === "authoring" ? "authoring" : "idle";
  }
}

function deriveWorkspaceStage(input: {
  authoringRoute: AuthoringRoute | null;
  authoringWorkflow: AuthoringWorkflowSummary | null;
  pendingApproval: boolean;
}): "chat" | "explore" | "author" | "approval" {
  if (input.authoringWorkflow?.active_stage) {
    return input.authoringWorkflow.active_stage;
  }

  if (input.pendingApproval || input.authoringRoute === "approval") {
    return "approval";
  }

  if (input.authoringRoute === "authoring") {
    return "author";
  }

  return "chat";
}

function getAgentGuidance(
  document: DashboardDocument,
  selectedViewTitle: string | null,
  t: TranslateFn,
): {
  message: string;
  placeholder: string;
} {
  if (selectedViewTitle) {
    return {
      message: t("authoring.chat.guidanceFocusedMessage", { title: selectedViewTitle }),
      placeholder: t("authoring.chat.guidanceFocusedPlaceholder", {
        title: selectedViewTitle,
      }),
    };
  }

  const viewsCount = document.dashboard_spec.views.length;
  const bindingsCount = document.bindings.length;

  if (viewsCount === 0) {
    return {
      message: t("authoring.chat.guidanceEmptyMessage"),
      placeholder: t("authoring.chat.guidanceEmptyPlaceholder"),
    };
  }

  if (bindingsCount === 0) {
    return {
      message: t("authoring.chat.guidanceNeedsDataMessage", { count: viewsCount }),
      placeholder: t("authoring.chat.guidanceNeedsDataPlaceholder", { count: viewsCount }),
    };
  }

  if (bindingsCount < viewsCount) {
    return {
      message: t("authoring.chat.guidancePartialDataMessage", {
        count: viewsCount - bindingsCount,
      }),
      placeholder: t("authoring.chat.guidancePartialDataPlaceholder"),
    };
  }

  return {
    message: t("authoring.chat.guidanceReadyMessage"),
    placeholder: t("authoring.chat.guidanceReadyPlaceholder"),
  };
}
