"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AuthoringTaskStatus } from "../../../ai/runtime/authoring-task-state";
import { getViewOptionTemplate } from "../../../domain/dashboard/contract-kernel";
import type { DashboardDocument, EChartsOptionTemplate, QueryOutput, QueryParamDef, ResultSchemaField } from "../../../contracts";
import { addBlankQueryToDashboard, applyQueryShape, updateQueryMeta } from "../state/query-editing";
import { applyTemplateToView, deleteViewFromDashboard, updateViewMeta } from "../state/view-editing";
import { createOrUpdateBindingForView, updateBindingFieldMapping, updateBindingParamMapping } from "../state/binding-editing";
import { storeDashboardPreview } from "../api/preview-link-storage";

interface RecordTaskEventInput {
  kind:
    | "agent_request"
    | "workflow_update"
    | "approval_requested"
    | "patch_applied"
    | "layout_intervention"
    | "contract_intervention"
    | "view_added"
    | "draft_saved"
    | "dashboard_published";
  title: string;
  detail: string;
  dedupeKey?: string;
  metadata?: Record<string, string | number | boolean | null>;
  patch?: {
    dashboardId?: string | null;
    dashboardName?: string;
    status?: string;
    summary?: string;
    currentGoal?: string;
    pendingApproval?: boolean;
    runtimeStatus?: string;
    intervention?:
      | {
          kind: "layout" | "contract";
          active: boolean;
          viewId?: string | null;
          viewTitle?: string | null;
          updatedAt: string;
        }
      | null;
    updatedAt?: string;
  };
}

interface UseAuthoringAppActionsInput {
  dashboardId?: string | null;
  dashboard: DashboardDocument;
  dashboardRef: MutableRefObject<DashboardDocument>;
  selectedViewId: string | null;
  selectedView: DashboardDocument["dashboard_spec"]["views"][number] | null;
  selectedQuery: DashboardDocument["query_defs"][number] | undefined;
  baselineTaskStatus: AuthoringTaskStatus;
  updateDashboard: (
    updater: (next: DashboardDocument) => void,
    options?: {
      syncMobileFromDesktop?: boolean;
      reconcileBreakpoint?: "desktop" | "mobile";
      anchoredViewId?: string;
      clearPreview?: boolean;
    },
  ) => void;
  runPreviewForDocument: (document: DashboardDocument) => Promise<void>;
  handleSaveDashboard: () => Promise<boolean>;
  handlePublishDashboard: () => Promise<boolean>;
  recordTaskEvent: (input: RecordTaskEventInput) => Promise<unknown>;
  setSelectedViewId: Dispatch<SetStateAction<string | null>>;
  setSelectedQueryId: Dispatch<SetStateAction<string | null>>;
  setAdvancedMode: Dispatch<SetStateAction<boolean>>;
  setTemplateInput: Dispatch<SetStateAction<string>>;
  setTemplateError: Dispatch<SetStateAction<string | null>>;
  templateInput: string;
  setQueryParamsInput: Dispatch<SetStateAction<string>>;
  queryParamsInput: string;
  setQuerySchemaInput: Dispatch<SetStateAction<string>>;
  querySchemaInput: string;
  setQueryError: Dispatch<SetStateAction<string | null>>;
}

export function useAuthoringAppActions({
  dashboardId,
  dashboard,
  dashboardRef,
  selectedViewId,
  selectedView,
  selectedQuery,
  baselineTaskStatus,
  updateDashboard,
  runPreviewForDocument,
  handleSaveDashboard,
  handlePublishDashboard,
  recordTaskEvent,
  setSelectedViewId,
  setSelectedQueryId,
  setAdvancedMode,
  setTemplateInput,
  setTemplateError,
  templateInput,
  setQueryParamsInput,
  queryParamsInput,
  setQuerySchemaInput,
  querySchemaInput,
  setQueryError,
}: UseAuthoringAppActionsInput) {

  const handleDashboardNameChange = useCallback(
    (value: string) => {
      updateDashboard((next) => {
        next.dashboard_spec.dashboard.name = value;
      });
    },
    [updateDashboard],
  );

  const handleDeleteView = useCallback(
    (viewId: string) => {
      if (!viewId) {
        return;
      }

      const remainingViews = dashboard.dashboard_spec.views
        .filter((view) => view.id !== viewId)
        .map((view) => view.id);

      updateDashboard(
        (next) => {
          deleteViewFromDashboard(next, viewId);
        },
        { syncMobileFromDesktop: true },
      );

      if (selectedViewId === viewId) {
        setSelectedViewId(remainingViews[0] ?? null);
        setAdvancedMode(false);
      }
    },
    [dashboard.dashboard_spec.views, selectedViewId, setAdvancedMode, setSelectedViewId, updateDashboard],
  );

  const handleViewMetaChange = useCallback(
    (field: "title" | "description", value: string) => {
      if (!selectedViewId) {
        return;
      }

      updateDashboard((next) => {
        updateViewMeta(next, selectedViewId, field, value);
      });
    },
    [selectedViewId, updateDashboard],
  );

  const handleApplyTemplate = useCallback(() => {
    if (!selectedViewId) {
      return;
    }

    try {
      const parsed = JSON.parse(templateInput) as EChartsOptionTemplate;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("option_template must be a JSON object.");
      }

      updateDashboard((next) => {
        applyTemplateToView(next, selectedViewId, parsed);
      });
      setTemplateError(null);
    } catch (error) {
      setTemplateError(
        error instanceof Error
          ? error.message
          : "Unable to parse option_template JSON.",
      );
    }
  }, [selectedViewId, setTemplateError, templateInput, updateDashboard]);

  const handleResetTemplate = useCallback(() => {
    if (!selectedView) {
      return;
    }

    setTemplateInput(JSON.stringify(getViewOptionTemplate(selectedView), null, 2));
  }, [selectedView, setTemplateInput]);

  const handleAddQuery = useCallback(() => {
    if (!selectedView) {
      return;
    }

    let nextQueryId: string | null = null;
    updateDashboard((next) => {
      nextQueryId = addBlankQueryToDashboard(next, selectedView.id);
    });

    if (nextQueryId) {
      setSelectedQueryId(nextQueryId);
    }
  }, [selectedView, setSelectedQueryId, updateDashboard]);

  const handleCreateOrUpdateBinding = useCallback(
    (queryId: string) => {
      if (!selectedView) {
        return;
      }

      let nextQueryId: string | null = null;
      updateDashboard((next) => {
        nextQueryId = createOrUpdateBindingForView(next, selectedView.id, queryId);
      });

      if (nextQueryId) {
        setSelectedQueryId(nextQueryId);
      }
    },
    [selectedView, setSelectedQueryId, updateDashboard],
  );

  const handleSelectQuery = useCallback(
    (nextQueryId: string | null) => {
      setSelectedQueryId(nextQueryId);
      if (nextQueryId) {
        handleCreateOrUpdateBinding(nextQueryId);
      }
    },
    [handleCreateOrUpdateBinding, setSelectedQueryId],
  );

  const handleQueryMetaChange = useCallback(
    (
      field: "id" | "name" | "datasource_id" | "sql_template",
      value: string,
    ) => {
      if (!selectedQuery) {
        return;
      }

      updateDashboard((next) => {
        const nextQueryId = updateQueryMeta(next, selectedQuery.id, field, value);
        setSelectedQueryId(nextQueryId);
      });
    },
    [selectedQuery, setSelectedQueryId, updateDashboard],
  );

  const handleApplyQueryShape = useCallback(() => {
    if (!selectedQuery) {
      return;
    }

    try {
      const params = JSON.parse(queryParamsInput) as QueryParamDef[];
      const queryOutput = JSON.parse(querySchemaInput) as QueryOutput | ResultSchemaField[];

      if (!Array.isArray(params)) {
        throw new Error("params must be an array.");
      }

      updateDashboard((next) => {
        applyQueryShape(next, selectedQuery.id, params, queryOutput);
      });
      setQueryError(null);
    } catch (error) {
      setQueryError(
        error instanceof Error
          ? error.message
          : "Unable to parse query params/output JSON.",
      );
    }
  }, [queryParamsInput, querySchemaInput, selectedQuery, setQueryError, updateDashboard]);

  const handleBindingParamChange = useCallback(
    (paramName: string, field: "source" | "value", value: string) => {
      if (!selectedView || !selectedQuery) {
        return;
      }

      handleCreateOrUpdateBinding(selectedQuery.id);
      updateDashboard((next) => {
        updateBindingParamMapping(next, selectedView.id, paramName, field, value);
      });
    },
    [handleCreateOrUpdateBinding, selectedQuery, selectedView, updateDashboard],
  );

  const handleFieldMappingChange = useCallback(
    (templateField: string, resultField: string) => {
      if (!selectedView || !selectedQuery) {
        return;
      }

      handleCreateOrUpdateBinding(selectedQuery.id);
      updateDashboard((next) => {
        updateBindingFieldMapping(next, selectedView.id, templateField, resultField);
      });
    },
    [handleCreateOrUpdateBinding, selectedQuery, selectedView, updateDashboard],
  );

  const handleRunPreview = useCallback(async () => {
    await runPreviewForDocument(dashboardRef.current);
  }, [dashboardRef, runPreviewForDocument]);

  const handleSaveDashboardAction = useCallback(async () => {
    const saved = await handleSaveDashboard();
    if (!saved) {
      return;
    }

    void recordTaskEvent({
      kind: "draft_saved",
      title: "Draft save requested",
      detail: "The current dashboard draft was saved through the human control plane.",
      patch: {
        dashboardId,
        dashboardName: dashboard.dashboard_spec.dashboard.name,
        updatedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
  }, [dashboard.dashboard_spec.dashboard.name, dashboardId, handleSaveDashboard, recordTaskEvent]);

  const handlePublishDashboardAction = useCallback(async () => {
    const published = await handlePublishDashboard();
    if (!published) {
      return;
    }

    void recordTaskEvent({
      kind: "dashboard_published",
      title: "Publish requested",
      detail: "The current dashboard draft was published from the control plane.",
      patch: {
        dashboardId,
        dashboardName: dashboard.dashboard_spec.dashboard.name,
        status: "published",
        updatedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
  }, [dashboard.dashboard_spec.dashboard.name, dashboardId, handlePublishDashboard, recordTaskEvent]);

  const handleOpenViewIntervention = useCallback(() => {
    const nextViewId = selectedViewId ?? dashboard.dashboard_spec.views[0]?.id ?? null;

    if (!nextViewId) {
      return;
    }

    setSelectedViewId(nextViewId);
    setAdvancedMode(true);
    const nextView = dashboard.dashboard_spec.views.find((view) => view.id === nextViewId);
    void recordTaskEvent({
      kind: "contract_intervention",
      title: "View contract intervention opened",
      detail: nextView
        ? `A human opened the contract editor for ${nextView.title}.`
        : "A human opened the contract editor for the selected view.",
      patch: {
        status: "intervention",
        dashboardId,
        dashboardName: dashboard.dashboard_spec.dashboard.name,
        intervention: {
          kind: "contract",
          active: true,
          viewId: nextViewId,
          viewTitle: nextView?.title ?? null,
          updatedAt: new Date().toISOString(),
        },
      },
    }).catch(() => undefined);
  }, [
    dashboard.dashboard_spec.dashboard.name,
    dashboard.dashboard_spec.views,
    dashboardId,
    recordTaskEvent,
    selectedViewId,
    setAdvancedMode,
    setSelectedViewId,
  ]);

  const handleCloseAdvancedIntervention = useCallback(() => {
    setAdvancedMode(false);
    setSelectedViewId(null);

    void recordTaskEvent({
      kind: "contract_intervention",
      title: "View contract intervention closed",
      detail: selectedView
        ? `Manual contract correction ended for ${selectedView.title}, and control returns to the agent.`
        : "Manual contract correction ended and control returns to the agent.",
      patch: {
        status: baselineTaskStatus,
        dashboardId,
        dashboardName: dashboard.dashboard_spec.dashboard.name,
        intervention: null,
        updatedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
  }, [
    baselineTaskStatus,
    dashboard.dashboard_spec.dashboard.name,
    dashboardId,
    recordTaskEvent,
    selectedView,
    setAdvancedMode,
    setSelectedViewId,
  ]);

  const handleClearViewFocus = useCallback(() => {
    setAdvancedMode(false);
    setSelectedViewId(null);
  }, [setAdvancedMode, setSelectedViewId]);

  const handleCanvasEditView = useCallback(
    (viewId: string) => {
      setSelectedViewId(viewId);
      setAdvancedMode(true);
      const view = dashboard.dashboard_spec.views.find((candidate) => candidate.id === viewId);
      void recordTaskEvent({
        kind: "contract_intervention",
        title: "View contract intervention opened",
        detail: view
          ? `A human opened the contract editor for ${view.title}.`
          : "A human opened the contract editor for the selected view.",
        patch: {
          status: "intervention",
          dashboardId,
          dashboardName: dashboard.dashboard_spec.dashboard.name,
          intervention: {
            kind: "contract",
            active: true,
            viewId,
            viewTitle: view?.title ?? null,
            updatedAt: new Date().toISOString(),
          },
        },
      }).catch(() => undefined);
    },
    [dashboard.dashboard_spec.dashboard.name, dashboard.dashboard_spec.views, dashboardId, recordTaskEvent, setAdvancedMode, setSelectedViewId],
  );

  const handleStorePreview = useCallback(() => {
    return storeDashboardPreview(dashboardRef.current);
  }, [dashboardRef]);

  return {
    handleDashboardNameChange,
    handleDeleteView,
    handleViewMetaChange,
    handleApplyTemplate,
    handleResetTemplate,
    handleAddQuery,
    handleCreateOrUpdateBinding,
    handleSelectQuery,
    handleQueryMetaChange,
    handleApplyQueryShape,
    handleBindingParamChange,
    handleFieldMappingChange,
    handleRunPreview,
    handleSaveDashboardAction,
    handlePublishDashboardAction,
    handleOpenViewIntervention,
    handleCloseAdvancedIntervention,
    handleClearViewFocus,
    handleCanvasEditView,
    handleStorePreview,
  };
}
