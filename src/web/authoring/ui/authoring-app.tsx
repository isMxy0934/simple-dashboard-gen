"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardDocument } from "../../../contracts";
import { type AuthoringBreakpoint } from "../state/authoring-state";
import { validateDashboardDocument } from "../../../contracts/validation";
import { AuthoringCanvasPanel } from "./authoring-canvas-panel";
import { AuthoringChatPanel } from "./authoring-chat-panel";
import { AuthoringEditorDrawer } from "./authoring-editor-drawer";
import { AuthoringOverlays } from "./authoring-overlays";
import { AuthoringTopbar } from "./authoring-topbar";
import { useAuthoringAgentSession } from "../agent/use-agent-session";
import {
  listAuthoringAgentSessions,
  type AuthoringAgentSessionSummary,
} from "../agent/agent-session-client";
import { useCanvasInteraction } from "../hooks/use-canvas-interaction";
import { useAuthoringController } from "../hooks/use-authoring-controller";
import { useAuthoringDock } from "../hooks/use-authoring-dock";
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
  const [dockClientReady, setDockClientReady] = useState(false);
  const {
    workspaceId,
    resolved: workspaceResolved,
    effectiveUserId,
    editingSessionId,
    chatSessionId,
    selectChatSessionId,
    createNewChatSession,
  } = useWorkspaceContext(dashboardId);
  const controllerUserId = workspaceResolved ? effectiveUserId : "";
  const [agentSessions, setAgentSessions] = useState<AuthoringAgentSessionSummary[]>([]);
  const [locallyCreatedChatSessionIds, setLocallyCreatedChatSessionIds] =
    useState<Set<string>>(() => new Set());
  const previousAgentStatusRef = useRef<string | null>(null);
  const {
    inlinePreview,
    publishedShareUrl,
    copiedShareLink,
    toggleInlinePreview,
    closeInlinePreview,
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
    focusedViewProgress,
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

  const {
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
    handleRunPreview,
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

  const {
    dockBoundsRef,
    chatDockCollapsed,
    setChatDockCollapsed,
    chatDockPosition,
    chatDockDragging,
    beginChatDockDrag,
    onChatDockPointerMove,
    endChatDockCapsule,
    endChatDockHeader,
    getAiDockPanelSize,
  } = useAuthoringDock();
  const aiDockPanelSize = dockClientReady
    ? getAiDockPanelSize(chatDockCollapsed)
    : { w: chatDockCollapsed ? 48 : 380, h: chatDockCollapsed ? 48 : 680 };
  const resolvedChatDockPosition = dockClientReady ? chatDockPosition : null;

  useEffect(() => {
    setDockClientReady(true);
  }, []);

  return (
    <div className={`${styles.shell} ${embedded ? styles.shellEmbedded : ""}`}>
      <AuthoringTopbar
        breakpoint={breakpoint}
        setBreakpoint={setBreakpoint}
        undoDepth={undoDepth}
        hydrated={hydrated}
        saveInFlight={saveInFlight}
        publishInFlight={publishInFlight}
        dashboardId={dashboardId}
        dashboardTitle={dashboard.dashboard_spec.dashboard.name}
        inlinePreviewOpen={Boolean(inlinePreview)}
        embedded={embedded}
        embeddedMenuCollapsed={embeddedMenuCollapsed}
        styles={styles}
        t={t}
        onUndo={() => void handleUndoLastChange()}
        onRunCheck={() => void handleRunPreview()}
        onSave={() => void handleSaveDashboardAction()}
        onPublish={() => void handlePublishClick()}
        onToggleInlinePreview={() => toggleInlinePreview(dashboardRef.current)}
        onToggleEmbeddedMenu={onToggleEmbeddedMenu}
      />

      <div
        ref={dockBoundsRef}
        className={`${styles.workspace} ${embedded ? styles.workspaceEmbedded : ""}`}
      >
        <div className={styles.workspaceLayout}>
          <aside className={styles.viewRail} aria-label={t("authoring.structure.title")}>
            <div className={styles.viewRailHeader}>
              <span>{t("authoring.structure.title")}</span>
              <strong>{dashboard.dashboard_spec.views.length}</strong>
            </div>
            <div className={styles.viewRailList}>
              {dashboard.dashboard_spec.views.map((view, index) => {
                const isActive = selectedViewId === view.id;
                const bindingCount = dashboard.bindings.filter(
                  (binding) => binding.view_id === view.id,
                ).length;
                return (
                  <button
                    key={view.id}
                    type="button"
                    className={isActive ? styles.viewRailItemActive : styles.viewRailItem}
                    onClick={() => {
                      setSelectedViewId(view.id);
                      setAdvancedMode(false);
                    }}
                  >
                    <span className={styles.viewRailIndex}>{index + 1}</span>
                    <span className={styles.viewRailCopy}>
                      <span className={styles.viewRailTitle}>
                        {view.title.replace(/\bDashboard\b/gi, "Report")}
                      </span>
                      <span className={styles.viewRailMeta}>
                        {bindingCount > 0
                          ? t("authoring.structure.bound")
                          : t("authoring.structure.draft")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
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
        </div>
      </div>

      {dockClientReady ? (
        <div
          className={styles.aiDockLayer}
          style={
            resolvedChatDockPosition
              ? {
                  position: "fixed",
                  left: `${resolvedChatDockPosition.x}px`,
                  top: `${resolvedChatDockPosition.y}px`,
                  width: `${aiDockPanelSize.w}px`,
                  height: `${aiDockPanelSize.h}px`,
                  zIndex: 50,
                }
              : {
                  position: "fixed",
                  right: "12px",
                  bottom: "12px",
                  width: `${aiDockPanelSize.w}px`,
                  height: `${aiDockPanelSize.h}px`,
                  zIndex: 50,
                }
          }
          data-dragging={chatDockDragging ? "true" : undefined}
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
            agentError={agentError}
            agentUiAlert={agentUiAlert}
            workspaceSummary={{
              dashboardName: contractStateSummary.dashboard_name,
              viewCount: contractStateSummary.views.length,
              bindingCount: contractStateSummary.binding_count,
              activeStage: workspaceActiveStage,
            }}
            focusedViewProgress={focusedViewProgress}
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
            dockCollapsed={chatDockCollapsed}
            onToggleDock={() => setChatDockCollapsed((current) => !current)}
            onExpandDock={() => setChatDockCollapsed(false)}
            beginDockDrag={beginChatDockDrag}
            onDockPointerMove={onChatDockPointerMove}
            endDockCapsule={endChatDockCapsule}
            endDockHeader={endChatDockHeader}
          />
        </div>
      ) : null}

      <AuthoringOverlays
        publishedShareUrl={publishedShareUrl}
        copiedShareLink={copiedShareLink}
        inlinePreview={inlinePreview}
        previewViewMode={breakpoint}
        styles={styles}
        t={t}
        onCopyShareLink={() => void copyPublishedShareLink()}
        onClosePreview={closeInlinePreview}
      />
    </div>
  );
}
