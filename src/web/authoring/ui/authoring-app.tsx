"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
    selectedUser,
    sessionId,
    selectSessionId,
    createNewSession,
  } = useWorkspaceContext(dashboardId);
  const effectiveUserId = selectedUser?.user_id || "usr_alice";
  const [agentSessions, setAgentSessions] = useState<AuthoringAgentSessionSummary[]>([]);
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
    bumpPersistedDraftVersion,
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
    userId: effectiveUserId,
    sessionId,
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
    authoringWorkflow,
    pendingPatchApproval,
    recordTaskEvent,
    handleGenerateAi,
    handleApprovePendingPatch,
    handleRejectPendingPatch,
  } = useAuthoringAgentSession({
    workspaceId,
    userId: effectiveUserId,
    dashboardRef,
    dashboardId: dashboardId ?? "",
    selectedViewId,
    sessionId,
    getBaseVersion,
    replaceDashboard,
    runPreviewForDocument,
    onAppliedDashboard: (nextDashboard, focusedViewId) => {
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
  });

  const refreshAgentSessions = useCallback(async () => {
    if (!dashboardId) {
      setAgentSessions([]);
      return;
    }

    const sessions = await listAuthoringAgentSessions({
      workspaceId,
      userId: effectiveUserId,
      dashboardId,
    });
    setAgentSessions(sessions);
  }, [dashboardId, effectiveUserId, workspaceId]);

  useEffect(() => {
    void refreshAgentSessions();
  }, [refreshAgentSessions, sessionId, agentMessages.length]);

  const handleNewAgentSession = useCallback(() => {
    createNewSession();
    setAgentSessions((current) => current);
  }, [createNewSession]);

  const handleSelectAgentSession = useCallback((nextSessionId: string) => {
    selectSessionId(nextSessionId);
  }, [selectSessionId]);

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
    authoringWorkflow,
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
    authoringWorkflow?.active_stage ??
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
      if (dashboardId) {
        bumpPersistedDraftVersion();
      }
      const view = viewMap.get(viewId);
      void recordTaskEvent({
        kind: "layout_intervention",
        title: mode === "move" ? "View moved manually" : "View resized manually",
        detail: view
          ? `A human ${mode === "move" ? "repositioned" : "resized"} ${view.title} on the ${interactionBreakpoint} layout.`
          : "A human adjusted the dashboard layout manually.",
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
      bumpPersistedDraftVersion,
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
        dashboard={dashboard}
        breakpoint={breakpoint}
        setBreakpoint={setBreakpoint}
        undoDepth={undoDepth}
        hydrated={hydrated}
        saveInFlight={saveInFlight}
        publishInFlight={publishInFlight}
        dashboardId={dashboardId}
        inlinePreviewOpen={Boolean(inlinePreview)}
        embedded={embedded}
        embeddedMenuCollapsed={embeddedMenuCollapsed}
        styles={styles}
        t={t}
        onDashboardNameChange={handleDashboardNameChange}
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
              breakpointLabel={
                breakpoint === "desktop"
                  ? t("authoring.topbar.desktop")
                  : t("authoring.topbar.mobile")
              }
              breakpoint={breakpoint}
              dashboard={dashboard}
              dashboardId={dashboardId ?? null}
              activeLayout={activeLayout}
              viewMap={viewMap}
              bindings={dashboard.bindings}
              queryDefs={dashboard.query_defs}
              previewResults={previewResults}
              previewRendererChecks={previewRendererChecks}
              previewState={previewState}
              hasDataDraft={hasDataDraft}
              selectedViewId={selectedViewId}
              onSelectView={setSelectedViewId}
              onClearSelection={handleClearViewFocus}
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
            userId={effectiveUserId}
            dashboardId={dashboardId ?? ""}
            currentSessionId={sessionId}
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
        dashboardName={dashboard.dashboard_spec.dashboard.name}
        styles={styles}
        t={t}
        onCopyShareLink={() => void copyPublishedShareLink()}
        onClosePreview={closeInlinePreview}
      />
    </div>
  );
}
