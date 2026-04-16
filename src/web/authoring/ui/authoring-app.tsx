"use client";

import Link from "next/link";
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
import { useCanvasInteraction } from "../hooks/use-canvas-interaction";
import { useAuthoringController } from "../hooks/use-authoring-controller";
import { useAuthoringDock } from "../hooks/use-authoring-dock";
import { useAuthoringPresence } from "../hooks/use-authoring-presence";
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
  const {
    loading: workspaceLoading,
    error: workspaceError,
    workspaceId,
    workspaceName,
    selectedUser,
    verbose,
    sessionId,
  } = useWorkspaceContext(dashboardId);
  const effectiveUserId = selectedUser?.user_id || "usr_alice";
  const { editingPresence, activeEditorNames } = useAuthoringPresence({
    workspaceId,
    dashboardId,
  });
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
    datasources,
    datasourcesStatus,
    datasourcesMessage,
    mobileLayoutMode,
    setMobileLayoutMode,
    mobileLayoutModeRef,
    storageMessage,
    previewState,
    previewMessage,
    previewResults,
    previewRendererChecks,
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
    showAgentProcess,
    setShowAgentProcess,
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
    replaceDashboard,
    runPreviewForDocument,
    onAppliedDashboard: (nextDashboard, focusedViewId) => {
      const fallbackViewId =
        selectedViewId &&
        nextDashboard.dashboard_spec.views.some((view) => view.id === selectedViewId)
          ? selectedViewId
          : nextDashboard.dashboard_spec.views[0]?.id ?? null;
      const nextSelectedViewId =
        focusedViewId &&
        nextDashboard.dashboard_spec.views.some((view) => view.id === focusedViewId)
          ? focusedViewId
          : fallbackViewId;
      setSelectedViewId(nextSelectedViewId);
    },
  });

  useEffect(() => {
    setShowAgentProcess(verbose);
  }, [setShowAgentProcess, verbose]);
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
        ? "write"
        : "read");

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
    handleOpenViewIntervention,
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
    setQueryParamsInput,
    queryParamsInput,
    setQuerySchemaInput,
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
        ? `${window.location.origin}/viewer/${dashboardId}`
        : `/viewer/${dashboardId}`;
    setPublishedDashboardUrl(nextUrl);
  }, [dashboardId, handlePublishDashboardAction, setPublishedDashboardUrl]);

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

  return (
    <div className={`${styles.shell} ${embedded ? styles.shellEmbedded : ""}`}>
      <AuthoringTopbar
        dashboard={dashboard}
        storageMessage={storageMessage}
        workspaceLoading={workspaceLoading}
        workspaceError={workspaceError}
        workspaceName={workspaceName}
        selectedUserName={selectedUser?.name ?? null}
        sessionId={sessionId}
        editingPresenceNames={activeEditorNames}
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

      <div
        className={styles.aiDockLayer}
        style={
          chatDockPosition
            ? {
                position: "fixed",
                left: chatDockPosition.x,
                top: chatDockPosition.y,
                width: getAiDockPanelSize(chatDockCollapsed).w,
                height: getAiDockPanelSize(chatDockCollapsed).h,
                zIndex: 50,
              }
            : {
                position: "fixed",
                right: 12,
                bottom: 12,
                width: getAiDockPanelSize(chatDockCollapsed).w,
                height: getAiDockPanelSize(chatDockCollapsed).h,
                zIndex: 50,
              }
        }
        data-dragging={chatDockDragging ? "true" : undefined}
      >
        <AuthoringChatPanel
          agentMessages={agentMessages}
          agentGuidance={agentGuidance}
          showAgentProcess={showAgentProcess}
          setShowAgentProcess={setShowAgentProcess}
          previewState={previewState}
          previewMessage={previewMessage}
          agentError={agentError}
          agentUiAlert={agentUiAlert}
          authoringRoute={authoringRoute}
          authoringTask={authoringTask}
          authoringWorkflow={authoringWorkflow}
          workspaceSummary={{
            dashboardName: contractStateSummary.dashboard_name,
            viewCount: contractStateSummary.views.length,
            bindingCount: contractStateSummary.binding_count,
            activeStage: workspaceActiveStage,
          }}
          focusedViewProgress={focusedViewProgress}
          interventionControls={{
            selectedViewTitle: selectedView?.title ?? null,
            onOpenViewIntervention: handleOpenViewIntervention,
          }}
          canvasFocusTitle={selectedView?.title ?? null}
          onClearCanvasFocus={handleClearViewFocus}
          pendingPatchApproval={pendingPatchApproval}
          onApprovePendingPatch={handleApprovePendingPatch}
          onRejectPendingPatch={handleRejectPendingPatch}
          validationIssues={validationResult.issues}
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
