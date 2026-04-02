"use client";

import { useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { isLiveBinding } from "../../../domain/dashboard/bindings";
import {
  getQueryOutput,
  getViewOptionTemplate,
} from "../../../domain/dashboard/contract-kernel";
import { getBindingsForView } from "../../../domain/dashboard/document";
import { collectEChartsTemplateFieldsFromView } from "../../../renderers/echarts/summary";
import type { DashboardAgentRoute } from "@/agent/dashboard-agent/contracts/route";
import type { DashboardAgentWorkflowSummary } from "@/agent/dashboard-agent/contracts/agent-contract";
import type { DashboardAgentTaskStatus } from "@/agent/dashboard-agent/contracts/task-state";
import { summarizeContractState } from "@/agent/dashboard-agent/context";
import { getAuthoringLayout } from "./use-authoring-controller";
import type {
  BindingResults,
  DashboardDocument,
} from "@/contracts";

interface ValidationIssue {
  path: string;
  message: string;
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
  authoringRoute: DashboardAgentRoute | null;
  authoringWorkflow: DashboardAgentWorkflowSummary | null;
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
  const contractStateSummary = useMemo(
    () => summarizeContractState(dashboard),
    [dashboard],
  );
  const hasDataDraft =
    dashboard.query_defs.length > 0 || dashboard.bindings.length > 0;
  const selectedViewTemplateFields = selectedView
    ? collectEChartsTemplateFieldsFromView(selectedView)
    : [];

  const selectedIssues = useMemo(() => {
    if (!selectedView) {
      return validationIssues;
    }

    const bindingId = selectedBinding?.id;
    const queryId = selectedQuery?.id;
    return validationIssues.filter((issue) => {
      return (
        issue.path.includes(selectedView.id) ||
        Boolean(bindingId && issue.path.includes(bindingId)) ||
        Boolean(queryId && issue.path.includes(queryId))
      );
    });
  }, [selectedBinding?.id, selectedQuery?.id, selectedView, validationIssues]);

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
    () => getAgentGuidance(dashboard),
    [dashboard],
  );
  const baselineTaskStatus = useMemo(
    () =>
      resolveDashboardAgentTaskStatus({
        route: authoringRoute ?? "chat",
        activeStage: authoringWorkflow?.active_stage ?? contractStateSummary.next_step,
        pendingApproval,
      }),
    [authoringRoute, authoringWorkflow?.active_stage, contractStateSummary.next_step, pendingApproval],
  );

  return {
    activeLayout,
    viewMap,
    selectedView,
    selectedBinding,
    selectedQuery,
    selectedBindingResult,
    selectedIssues,
    selectedViewTemplateFields,
    hasDataDraft,
    contractStateSummary,
    agentGuidance,
    baselineTaskStatus,
  };
}

function resolveDashboardAgentTaskStatus(input: {
  route: "authoring" | "approval" | "chat";
  activeStage: "read" | "write" | "approval";
  pendingApproval: boolean;
}): DashboardAgentTaskStatus {
  if (input.pendingApproval || input.route === "approval") {
    return "awaiting_approval";
  }

  switch (input.activeStage) {
    case "approval":
      return "reviewing";
    case "write":
      return input.route === "authoring" ? "authoring" : "idle";
    case "read":
    default:
      return input.route === "authoring" ? "authoring" : "idle";
  }
}

function getAgentGuidance(document: DashboardDocument): {
  message: string;
  placeholder: string;
} {
  const viewsCount = document.dashboard_spec.views.length;
  const bindingsCount = document.bindings.length;

  if (viewsCount === 0) {
    return {
      message:
        "我是 Dashboard Agent，协助您进行 Dashboard 创建。你可以直接描述业务需求、粘贴 SQL，或告诉我你的数据源。",
      placeholder: "告诉我你要创建什么 Dashboard，或直接粘贴 SQL / 数据源信息...",
    };
  }

  if (bindingsCount === 0) {
    return {
      message: `我看到你已经有 ${viewsCount} 个 view，还没有绑定数据。要我帮你生成 SQL 和 binding 吗？`,
      placeholder: `比如：为这 ${viewsCount} 个 view 生成 PostgreSQL SQL 和 binding 初稿...`,
    };
  }

  if (bindingsCount < viewsCount) {
    return {
      message: `当前还有 ${viewsCount - bindingsCount} 个 view 没有 binding。要我继续补齐剩余的数据链路吗？`,
      placeholder: "比如：补齐未绑定 view 的 SQL、field mapping 和 param mapping...",
    };
  }

  return {
    message:
      "Dashboard 看起来已经完整了。你可以让我继续优化布局、修复数据问题，或者做发布前检查。",
    placeholder: "你可以要求我继续优化布局、修复数据问题，或检查发布前风险...",
  };
}
