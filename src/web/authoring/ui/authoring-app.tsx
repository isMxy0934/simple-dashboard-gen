"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { DashboardDocument } from "../../../contracts";
import { type AuthoringBreakpoint } from "../state/authoring-state";
import { validateDashboardDocument } from "../../../contracts/validation";
import {
  listDashboardColorThemes,
  listDashboardDesignKits,
  listDashboardViewStyles,
  resolveDashboardColorTheme,
  resolveDashboardDesignKit,
  resolveDashboardTheme,
  resolveDashboardViewStyle,
} from "../../../presentation/dashboard/themes";
import { summarizeRendererValidationChecks } from "../../../renderers/core/validation-result";
import { AuthoringCanvasPanel } from "./authoring-canvas-panel";
import { AuthoringChatPanel } from "./authoring-chat-panel";
import { AuthoringEditorDrawer } from "./authoring-editor-drawer";
import { AuthoringOverlays } from "./authoring-overlays";
import { AuthoringTopbar } from "./authoring-topbar";
import { useAuthoringAgentSession } from "../agent/use-agent-session";
import { storeDashboardPreview } from "../api/preview-link-storage";
import {
  listAuthoringAgentSessions,
  type AuthoringAgentSessionSummary,
} from "../agent/agent-session-client";
import { useCanvasInteraction } from "../hooks/use-canvas-interaction";
import { useAuthoringController } from "../hooks/use-authoring-controller";
import { useAuthoringSharePreview } from "../hooks/use-authoring-share-preview";
import { useAuthoringAppActions } from "../hooks/use-authoring-app-actions";
import { useAuthoringAppState } from "../hooks/use-authoring-app-state";
import { useI18n } from "../../i18n/i18n-context";
import { useWorkspaceContext } from "../hooks/use-workspace-context";
import styles from "./authoring.module.css";

interface AuthoringAppProps {
  dashboardId?: string | null;
  embedded?: boolean;
  onSaved?: () => void;
  onToggleEmbeddedMenu?: () => void;
  embeddedMenuCollapsed?: boolean;
}

export function AuthoringApp({
  dashboardId,
  embedded = false,
  onSaved,
  onToggleEmbeddedMenu,
  embeddedMenuCollapsed = false,
}: AuthoringAppProps) {
  const { t } = useI18n();
  const [breakpoint, setBreakpoint] = useState<AuthoringBreakpoint>("desktop");
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(null);
  const [templateInput, setTemplateInput] = useState<string>("");
  const [queryParamsInput, setQueryParamsInput] = useState<string>("[]");
  const [querySchemaInput, setQuerySchemaInput] = useState<string>("[]");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [chatDockCollapsed, setChatDockCollapsed] = useState(false);
  const [previewHref, setPreviewHref] = useState("/viewer/preview");
  const {
    workspaceId,
    resolved: workspaceResolved,
    effectiveUserId,
    editingSessionId,
    chatSessionId,
    selectChatSessionId,
    createNewChatSession,
    verbose,
  } = useWorkspaceContext(dashboardId);
  const controllerUserId = workspaceResolved ? effectiveUserId : "";
  const [agentSessions, setAgentSessions] = useState<AuthoringAgentSessionSummary[]>([]);
  const [locallyCreatedChatSessionIds, setLocallyCreatedChatSessionIds] =
    useState<Set<string>>(() => new Set());
  const previousAgentStatusRef = useRef<string | null>(null);
  const {
    publishedShareUrl,
    copiedShareLink,
    setPublishedDashboardUrl,
    copyPublishedShareLink,
  } = useAuthoringSharePreview();

  const {
    dashboard,
    dashboardRef,
    getBaseVersion,
    datasources,
    datasourcesStatus,
    datasourcesMessage,
    mobileLayoutMode,
    setMobileLayoutMode,
    mobileLayoutModeRef,
    previewState,
    previewMessage,
    previewResults,
    previewRendererChecks,
    previewPublishIssues,
    applyDashboardMutation,
    commitDashboardMutation,
    hydrated,
    publishInFlight,
    saveInFlight,
    hasUnsavedChanges,
    undoDepth,
    updateDashboard,
    replaceDashboard,
    handleSaveDashboard,
    handlePublishDashboard,
    handleUndoLastChange,
    runPreviewForDocument,
  } = useAuthoringController({
    workspaceId,
    userId: controllerUserId,
    editingSessionId,
    dashboardId,
    breakpoint,
    selectedViewId,
    onSelectedViewIdChange: setSelectedViewId,
    onSaved,
  });

  const validationResult = useMemo(
    () => validateDashboardDocument(dashboard, "save"),
    [dashboard],
  );
  const dashboardDesignKits = useMemo(() => listDashboardDesignKits(), []);
  const previewRendererWarningCount = useMemo(
    () =>
      Object.values(previewRendererChecks).filter(
        (checks) => summarizeRendererValidationChecks(checks).status === "warning",
      ).length,
    [previewRendererChecks],
  );
  const activeDesignKit = resolveDashboardDesignKit(
    dashboard.dashboard_spec.presentation.design_kit_id,
  );
  const dashboardColorThemes = useMemo(
    () => listDashboardColorThemes(activeDesignKit.id),
    [activeDesignKit.id],
  );
  const dashboardViewStyles = useMemo(
    () => listDashboardViewStyles(activeDesignKit.id),
    [activeDesignKit.id],
  );
  const activeColorThemeId = resolveDashboardColorTheme(
    dashboard.dashboard_spec.presentation.color_theme_id,
    activeDesignKit.id,
  ).id;
  const activeDefaultViewStyleId = resolveDashboardViewStyle(
    dashboard.dashboard_spec.presentation.default_view_style_id,
    activeDesignKit.id,
  ).id;
  const activeThemeId = resolveDashboardTheme(
    activeColorThemeId,
    activeDesignKit.id,
  ).id;
  const handleDashboardDesignKitChange = useCallback(
    (designKitId: string) => {
      const nextKit = resolveDashboardDesignKit(designKitId);
      updateDashboard(
        (current) => ({
          ...current,
          dashboard_spec: {
            ...current.dashboard_spec,
            presentation: {
              design_kit_id: nextKit.id,
              color_theme_id: nextKit.defaultColorThemeId,
              default_view_style_id: nextKit.defaultViewStyleId,
            },
          },
        }),
        { clearPreview: false },
      );
    },
    [updateDashboard],
  );
  const handleDashboardColorThemeChange = useCallback(
    (colorThemeId: string) => {
      const nextColorTheme = resolveDashboardColorTheme(colorThemeId, activeDesignKit.id);
      updateDashboard(
        (current) => ({
          ...current,
          dashboard_spec: {
            ...current.dashboard_spec,
            presentation: {
              design_kit_id: activeDesignKit.id,
              color_theme_id: nextColorTheme.id,
              default_view_style_id: activeDefaultViewStyleId,
            },
          },
        }),
        { clearPreview: false },
      );
    },
    [activeDefaultViewStyleId, activeDesignKit.id, updateDashboard],
  );
  const handleDashboardDefaultViewStyleChange = useCallback(
    (viewStyleId: string) => {
      const nextViewStyle = resolveDashboardViewStyle(viewStyleId, activeDesignKit.id);
      updateDashboard(
        (current) => ({
          ...current,
          dashboard_spec: {
            ...current.dashboard_spec,
            presentation: {
              design_kit_id: activeDesignKit.id,
              color_theme_id: activeColorThemeId,
              default_view_style_id: nextViewStyle.id,
            },
          },
        }),
        { clearPreview: false },
      );
    },
    [activeColorThemeId, activeDesignKit.id, updateDashboard],
  );

  const handleAppliedDashboard = useCallback(
    (nextDashboard: DashboardDocument, focusedViewId?: string | null) => {
      const fallbackViewId =
        selectedViewId &&
        nextDashboard.dashboard_spec.views.some((view) => view.id === selectedViewId)
          ? selectedViewId
          : null;
      const nextSelectedViewId =
        focusedViewId &&
        nextDashboard.dashboard_spec.views.some((view) => view.id === focusedViewId)
          ? focusedViewId
          : fallbackViewId;
      setSelectedViewId(nextSelectedViewId);
    },
    [selectedViewId],
  );

  const {
    agentMessages,
    agentStatus,
    agentError,
    stopAgentGeneration,
    promptText,
    setPromptText,
    agentUiAlert,
    authoringTask,
    authoringRoute,
    authoringMode,
    pendingPatchApproval,
    recordTaskEvent,
    handleGenerateAi,
    handleApprovePendingPatch,
    handleRejectPendingPatch,
  } = useAuthoringAgentSession({
    workspaceId,
    userId: controllerUserId,
    dashboardRef,
    dashboardId: dashboardId ?? "",
    selectedViewId,
    chatSessionId,
    editingSessionId,
    isLocalNewChatSession: locallyCreatedChatSessionIds.has(chatSessionId),
    getBaseVersion,
    replaceDashboard,
    runPreviewForDocument,
    onAppliedDashboard: handleAppliedDashboard,
  });

  const refreshAgentSessions = useCallback(async () => {
    if (!dashboardId || !controllerUserId) {
      setAgentSessions([]);
      return;
    }

    const sessions = await listAuthoringAgentSessions({
      workspaceId,
      userId: controllerUserId,
      dashboardId,
    });
    setAgentSessions(sessions);
  }, [controllerUserId, dashboardId, workspaceId]);

  useEffect(() => {
    void refreshAgentSessions();
  }, [refreshAgentSessions]);

  useEffect(() => {
    const previous = previousAgentStatusRef.current;
    previousAgentStatusRef.current = agentStatus;
    const wasBusy = previous === "submitted" || previous === "streaming";
    const isBusy = agentStatus === "submitted" || agentStatus === "streaming";
    if (wasBusy && !isBusy) {
      setLocallyCreatedChatSessionIds((current) => {
        if (!current.has(chatSessionId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(chatSessionId);
        return next;
      });
      void refreshAgentSessions();
    }
  }, [agentStatus, chatSessionId, refreshAgentSessions]);

  const handleNewAgentSession = useCallback(() => {
    const nextChatSessionId = createNewChatSession();
    setLocallyCreatedChatSessionIds((current) => new Set(current).add(nextChatSessionId));
    void refreshAgentSessions();
  }, [createNewChatSession, refreshAgentSessions]);

  const handleSelectAgentSession = useCallback((nextSessionId: string) => {
    selectChatSessionId(nextSessionId);
    void refreshAgentSessions();
  }, [refreshAgentSessions, selectChatSessionId]);

  const {
    activeLayout,
    viewMap,
    selectedView,
    selectedBinding,
    selectedQuery,
    selectedBindingResult,
    selectedIssues,
    hasDataDraft,
    contractStateSummary,
    agentGuidance,
    baselineTaskStatus,
  } = useAuthoringAppState({
    breakpoint,
    dashboard,
    previewResults,
    validationIssues: validationResult.issues,
    selectedViewId,
    selectedQueryId,
    authoringTaskIntervention: authoringTask?.intervention,
    authoringRoute: authoringRoute?.route ?? null,
    authoringMode,
    pendingApproval: Boolean(pendingPatchApproval),
    setSelectedQueryId,
    setTemplateInput,
    setTemplateError,
    setQueryParamsInput,
    setQuerySchemaInput,
    setQueryError,
    setAdvancedMode,
    setSelectedViewId,
  });
  const workspaceActiveStage =
    authoringMode?.active_stage ??
    (pendingPatchApproval
      ? "approval"
      : authoringRoute?.route === "authoring"
        ? "author"
        : "chat");
  const copilotAttention =
    agentStatus === "submitted" ||
    agentStatus === "streaming" ||
    Boolean(pendingPatchApproval) ||
    Boolean(agentError) ||
    Boolean(agentUiAlert) ||
    previewState === "error";

  const {
    handleDashboardNameChange,
    handleDeleteView,
    handleViewMetaChange,
    handleViewStyleChange,
    handleApplyTemplate,
    handleResetTemplate,
    handleAddQuery,
    handleCreateOrUpdateBinding,
    handleSelectQuery,
    handleQueryMetaChange,
    handleApplyQueryShape,
    handleBindingParamChange,
    handleSaveDashboardAction,
    handlePublishDashboardAction,
    handleCloseAdvancedIntervention,
    handleClearViewFocus,
    handleCanvasEditView,
  } = useAuthoringAppActions({
    dashboardId,
    chatSessionId,
    dashboard,
    datasources,
    dashboardRef,
    mobileLayoutMode,
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
    queryParamsInput,
    querySchemaInput,
    setQueryError,
  });

  const handleCanvasInteractionCommit = useCallback(
    ({
      viewId,
      mode,
      breakpoint: interactionBreakpoint,
    }: {
      breakpoint: AuthoringBreakpoint;
      mode: "move" | "resize";
      viewId: string;
    }) => {
      const view = viewMap.get(viewId);
      void recordTaskEvent({
        kind: "layout_intervention",
        title: mode === "move" ? "View moved manually" : "View resized manually",
        detail: view
          ? `A human ${mode === "move" ? "repositioned" : "resized"} ${view.title} on the ${interactionBreakpoint} layout.`
          : "A human adjusted the report layout manually.",
        patch: {
          status: "intervention",
          dashboardId,
          dashboardName: dashboard.dashboard_spec.dashboard.name,
          intervention: {
            kind: "layout",
            active: true,
            viewId,
            viewTitle: view?.title ?? null,
            updatedAt: new Date().toISOString(),
          },
        },
      }).catch(() => undefined);
    },
    [
      dashboard.dashboard_spec.dashboard.name,
      dashboardId,
      recordTaskEvent,
      viewMap,
    ],
  );

  const handlePublishClick = useCallback(async () => {
    const published = await handlePublishDashboardAction();
    if (!published || !dashboardId) {
      return;
    }

    const nextUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/viewer/${dashboardId}?workspaceId=${encodeURIComponent(workspaceId)}`
        : `/viewer/${dashboardId}?workspaceId=${encodeURIComponent(workspaceId)}`;
    setPublishedDashboardUrl(nextUrl);
  }, [dashboardId, handlePublishDashboardAction, setPublishedDashboardUrl, workspaceId]);

  const handleOpenPreviewClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (typeof window === "undefined" || !hydrated) {
      event.preventDefault();
      return;
    }

    const previewKey = storeDashboardPreview(dashboardRef.current);
    const previewUrl = `${window.location.origin}/viewer/preview?previewKey=${encodeURIComponent(
      previewKey,
    )}`;
    event.currentTarget.href = previewUrl;
    setPreviewHref(previewUrl);
  }, [dashboardRef, hydrated]);

  const { canvasRef, startInteraction } = useCanvasInteraction({
    breakpoint,
    onSelectedViewIdChange: setSelectedViewId,
    onMobileLayoutModeChange: setMobileLayoutMode,
    dashboardRef,
    mobileLayoutModeRef,
    applyDashboardMutation,
    commitDashboardMutation,
    onInteractionCommit: handleCanvasInteractionCommit,
  });

  return (
    <div className={`${styles.shell} ${embedded ? styles.shellEmbedded : ""}`}>
      <AuthoringTopbar
        breakpoint={breakpoint}
        setBreakpoint={setBreakpoint}
        undoDepth={undoDepth}
        hydrated={hydrated}
        saveInFlight={saveInFlight}
        publishInFlight={publishInFlight}
        hasUnsavedChanges={hasUnsavedChanges}
        dashboardId={dashboardId}
        dashboardTitle={dashboard.dashboard_spec.dashboard.name}
        designKitId={activeDesignKit.id}
        designKits={dashboardDesignKits}
        colorThemeId={activeThemeId}
        colorThemes={dashboardColorThemes}
        defaultViewStyleId={activeDefaultViewStyleId}
        viewStyles={dashboardViewStyles}
        previewHref={previewHref}
        embedded={embedded}
        embeddedMenuCollapsed={embeddedMenuCollapsed}
        copilotCollapsed={chatDockCollapsed}
        copilotAttention={copilotAttention}
        styles={styles}
        t={t}
        onUndo={() => void handleUndoLastChange()}
        onSave={() => void handleSaveDashboardAction()}
        onPublish={() => void handlePublishClick()}
        onDesignKitChange={handleDashboardDesignKitChange}
        onColorThemeChange={handleDashboardColorThemeChange}
        onDefaultViewStyleChange={handleDashboardDefaultViewStyleChange}
        onOpenPreview={handleOpenPreviewClick}
        onToggleCopilot={() => setChatDockCollapsed((current) => !current)}
        onToggleEmbeddedMenu={onToggleEmbeddedMenu}
      />

      <div className={`${styles.workspace} ${embedded ? styles.workspaceEmbedded : ""}`}>
        <div
          className={`${styles.workspaceLayout} ${
            chatDockCollapsed ? styles.workspaceLayoutCopilotCollapsed : ""
          }`}
        >
          <div className={styles.workspaceMainColumn}>
            {previewPublishIssues.length > 0 ? (
              <details className={styles.issueSummary} open>
                <summary>{`发布前需要处理 ${previewPublishIssues.length} 个问题`}</summary>
                <div className={styles.issueListCompact}>
                  {previewPublishIssues.slice(0, 6).map((issue) => (
                    <div
                      key={`${issue.path}-${issue.message}`}
                      className={styles.issueItem}
                    >
                      <strong>{issue.path}</strong>
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            <AuthoringCanvasPanel
              breakpoint={breakpoint}
              onBreakpointChange={setBreakpoint}
              dashboard={dashboard}
              dashboardId={dashboardId ?? null}
              activeLayout={activeLayout}
              bindings={dashboard.bindings}
              queryDefs={dashboard.query_defs}
              previewResults={previewResults}
              previewRendererChecks={previewRendererChecks}
              previewState={previewState}
              hasDataDraft={hasDataDraft}
              selectedViewId={selectedViewId}
              onSelectView={setSelectedViewId}
              onClearSelection={handleClearViewFocus}
              onDashboardNameChange={handleDashboardNameChange}
              onEditView={handleCanvasEditView}
              onDeleteView={(viewId) => {
                handleDeleteView(viewId);
              }}
              onStartInteraction={startInteraction}
              canvasRef={canvasRef}
              styles={styles}
            >
              {advancedMode && selectedView ? (
                <AuthoringEditorDrawer
                  selectedView={selectedView}
                  selectedBinding={selectedBinding}
                  selectedBindingResult={selectedBindingResult}
                  previewState={previewState}
                  hasDataDraft={hasDataDraft}
                  selectedIssues={selectedIssues}
                  datasources={datasources}
                  datasourcesStatus={datasourcesStatus}
                  datasourcesMessage={datasourcesMessage}
                  templateInput={templateInput}
                  setTemplateInput={setTemplateInput}
                  templateError={templateError}
                  onApplyTemplate={handleApplyTemplate}
                  onResetTemplate={handleResetTemplate}
                  selectedQueryId={selectedQueryId}
                  queryDefs={dashboard.query_defs}
                  onSelectQuery={handleSelectQuery}
                  onAddQuery={handleAddQuery}
                  selectedQuery={selectedQuery}
                  queryParamsInput={queryParamsInput}
                  setQueryParamsInput={setQueryParamsInput}
                  querySchemaInput={querySchemaInput}
                  setQuerySchemaInput={setQuerySchemaInput}
                  queryError={queryError}
                  onQueryMetaChange={handleQueryMetaChange}
                  onApplyQueryShape={handleApplyQueryShape}
                  onCreateBinding={() =>
                    selectedQuery && handleCreateOrUpdateBinding(selectedQuery.id)
                  }
                  onViewMetaChange={handleViewMetaChange}
                  onViewStyleChange={handleViewStyleChange}
                  dashboardDefaultViewStyleId={activeDefaultViewStyleId}
                  viewStyles={dashboardViewStyles}
                  onBindingParamChange={handleBindingParamChange}
                  onSaveDashboard={handleSaveDashboardAction}
                  saveInFlight={saveInFlight}
                  saveDisabled={!hydrated || publishInFlight}
                  onClose={handleCloseAdvancedIntervention}
                  styles={styles}
                />
              ) : null}
            </AuthoringCanvasPanel>
          </div>
          {chatDockCollapsed ? null : (
            <aside
              className={styles.copilotColumn}
              aria-label={t("authoring.chat.dockPanelTitle")}
            >
              <AuthoringChatPanel
                agentMessages={agentMessages}
                agentSessions={agentSessions}
                workspaceId={workspaceId}
                userId={controllerUserId}
                dashboardId={dashboardId ?? ""}
                currentSessionId={chatSessionId}
                onNewSession={handleNewAgentSession}
                onSelectSession={handleSelectAgentSession}
                agentGuidance={agentGuidance}
                previewState={previewState}
                previewMessage={previewMessage}
                previewIssueCount={previewPublishIssues.length}
                previewRendererWarningCount={previewRendererWarningCount}
                verbose={verbose}
                agentError={agentError}
                agentUiAlert={agentUiAlert}
                workspaceSummary={{
                  dashboardName: contractStateSummary.dashboard_name,
                  viewCount: contractStateSummary.views.length,
                  bindingCount: contractStateSummary.binding_count,
                  activeStage: workspaceActiveStage,
                }}
                canvasFocusTitle={selectedView?.title ?? null}
                onClearCanvasFocus={handleClearViewFocus}
                pendingPatchApproval={pendingPatchApproval}
                onApprovePendingPatch={handleApprovePendingPatch}
                onRejectPendingPatch={handleRejectPendingPatch}
                promptText={promptText}
                setPromptText={setPromptText}
                agentStatus={agentStatus}
                onStop={stopAgentGeneration}
                onSend={handleGenerateAi}
                styles={styles}
                dockCollapsed={false}
                onToggleDock={() => setChatDockCollapsed(true)}
                onExpandDock={() => setChatDockCollapsed(false)}
                stationary
              />
            </aside>
          )}
        </div>
      </div>

      <AuthoringOverlays
        publishedShareUrl={publishedShareUrl}
        copiedShareLink={copiedShareLink}
        styles={styles}
        t={t}
        onCopyShareLink={() => void copyPublishedShareLink()}
      />
    </div>
  );
}
