"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { DashboardDocument } from "../../../contracts";
import { type AuthoringBreakpoint } from "../state/authoring-state";
import { validateDashboardDocument } from "../../../contracts/validation";
import { AuthoringCanvasPanel } from "./authoring-canvas-panel";
import { AuthoringChatPanel } from "./authoring-chat-panel";
import { AuthoringEditorDrawer } from "./authoring-editor-drawer";
import { useAuthoringAgentSession } from "../agent/use-agent-session";
import { useCanvasInteraction } from "../hooks/use-canvas-interaction";
import { useAuthoringController } from "../hooks/use-authoring-controller";
import { useAuthoringAppActions } from "../hooks/use-authoring-app-actions";
import { useAuthoringAppState } from "../hooks/use-authoring-app-state";
import {
  getAiDockPanelSize,
  useAiDockPosition,
} from "../hooks/use-ai-dock-position";
import { useI18n } from "../../i18n/i18n-context";
import { randomUuid } from "../../utils/random-uuid";
import { ViewerApp } from "../../viewer";
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
  const [inlinePreview, setInlinePreview] = useState<{
    document: DashboardDocument;
    savedAt: string;
  } | null>(null);
  const [publishedShareUrl, setPublishedShareUrl] = useState<string | null>(null);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [sessionId] = useState(() => `sess_${randomUuid()}`);

  const {
    dashboard,
    dashboardRef,
    localSessionId,
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
    agentNotice,
    authoringTask,
    authoringRoute,
    authoringWorkflow,
    pendingPatchApproval,
    recordTaskEvent,
    handleGenerateAi,
    handleApprovePendingPatch,
    handleRejectPendingPatch,
  } = useAuthoringAgentSession({
    dashboardRef,
    dashboardId,
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
    setPublishedShareUrl(nextUrl);
    setCopiedShareLink(false);
  }, [dashboardId, handlePublishDashboardAction]);

  const handleCopyShareLink = useCallback(async () => {
    if (!publishedShareUrl || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(publishedShareUrl);
    setCopiedShareLink(true);
  }, [publishedShareUrl]);

  const { canvasRef, startInteraction } = useCanvasInteraction({
    breakpoint,
    onSelectedViewIdChange: setSelectedViewId,
    onMobileLayoutModeChange: setMobileLayoutMode,
    dashboardRef,
    mobileLayoutModeRef,
    applyDashboardMutation,
    onInteractionCommit: handleCanvasInteractionCommit,
  });

  const dockBoundsRef = useRef<HTMLDivElement | null>(null);
  const [chatDockCollapsed, setChatDockCollapsed] = useState(false);
  const {
    position: chatDockPosition,
    dragging: chatDockDragging,
    beginDrag: beginChatDockDrag,
    onDragPointerMove: onChatDockPointerMove,
    endDragCapsule: endChatDockCapsule,
    endDragHeader: endChatDockHeader,
  } = useAiDockPosition(chatDockCollapsed, dockBoundsRef);

  return (
    <div className={`${styles.shell} ${embedded ? styles.shellEmbedded : ""}`}>
      <header className={`${styles.topbar} ${embedded ? styles.topbarEmbedded : ""}`}>
        <div className={styles.brandBlock}>
          <input
            className={styles.dashboardNameInput}
            value={dashboard.dashboard_spec.dashboard.name}
            onChange={(event) => handleDashboardNameChange(event.target.value)}
            aria-label={t("authoring.topbar.dashboardNameAria")}
          />
          <div className={styles.statusLine}>{storageMessage}</div>
        </div>

        <div className={styles.topbarActions}>
          <div className={`${styles.toolbarGroup} ${styles.toolbarGroupSubtools}`}>
            <div className={styles.segmented}>
              {(["desktop", "mobile"] as AuthoringBreakpoint[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={breakpoint === mode ? styles.segmentedActive : ""}
                  onClick={() => setBreakpoint(mode)}
                >
                  {mode === "desktop"
                    ? t("authoring.topbar.desktop")
                    : t("authoring.topbar.mobile")}
                </button>
              ))}
            </div>
          </div>

          <div className={`${styles.toolbarGroup} ${styles.toolbarGroupWorkspace}`}>
            <button
              type="button"
              className={`${styles.secondaryAction} ${styles.workspaceAction}`}
              disabled={!undoDepth}
              onClick={() => void handleUndoLastChange()}
            >
              {t("authoring.topbar.undo")}
            </button>
            <button
              type="button"
              className={`${styles.primaryAction} ${styles.saveAction}`}
              disabled={!hydrated || saveInFlight || publishInFlight}
              onClick={() => void handleSaveDashboardAction()}
            >
              {saveInFlight ? t("common.loading") : t("authoring.topbar.save")}
            </button>
            <button
              type="button"
              className={styles.publishAction}
              disabled={!hydrated || saveInFlight || publishInFlight || !dashboardId}
              onClick={() => void handlePublishClick()}
            >
              {publishInFlight ? t("common.loading") : t("authoring.topbar.publish")}
            </button>
            <button
              type="button"
              className={`${styles.secondaryAction} ${styles.workspaceAction}`}
              disabled={!hydrated}
              onClick={() => {
                setInlinePreview((current) =>
                  current
                    ? null
                    : {
                        document: dashboardRef.current,
                        savedAt: new Date().toISOString(),
                      },
                );
              }}
            >
              {inlinePreview
                ? t("authoring.topbar.closePreview")
                : t("authoring.topbar.openPreview")}
            </button>
            <Link
              href="/"
              className={`${styles.secondaryAction} ${styles.navAction}`}
            >
              {t("authoring.topbar.backHome")}
            </Link>
            {embedded ? (
              <button
                type="button"
                className={`${styles.secondaryAction} ${styles.navAction}`}
                onClick={onToggleEmbeddedMenu}
              >
                {embeddedMenuCollapsed
                  ? t("authoring.topbar.showMenu")
                  : t("authoring.topbar.hideMenu")}
              </button>
            ) : null}
          </div>
        </div>
      </header>

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
              dashboardName={dashboard.dashboard_spec.dashboard.name}
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
              onRunPreview={() => void handleRunPreview()}
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

      {chatDockPosition ? (
        <div
          className={styles.aiDockLayer}
          style={{
            position: "fixed",
            left: chatDockPosition.x,
            top: chatDockPosition.y,
            width: getAiDockPanelSize(chatDockCollapsed).w,
            height: getAiDockPanelSize(chatDockCollapsed).h,
            zIndex: 50,
          }}
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
            agentNotice={agentNotice}
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
      ) : null}

      {publishedShareUrl ? (
        <section className={styles.shareBanner}>
          <div className={styles.shareBannerCopy}>
            <div className={styles.panelEyebrow}>{t("authoring.topbar.shareEyebrow")}</div>
            <strong>{t("authoring.topbar.shareTitle")}</strong>
            <p>{publishedShareUrl}</p>
          </div>
          <div className={styles.shareBannerActions}>
            <button
              type="button"
              className={`${styles.secondaryAction} ${styles.workspaceAction}`}
              onClick={() => void handleCopyShareLink()}
            >
              {copiedShareLink
                ? t("authoring.topbar.shareCopied")
                : t("authoring.topbar.copyLink")}
            </button>
            <Link
              href={publishedShareUrl}
              className={`${styles.secondaryAction} ${styles.navAction}`}
            >
              {t("authoring.topbar.openPublished")}
            </Link>
          </div>
        </section>
      ) : null}

      {inlinePreview ? (
        <section className={styles.previewOverlay}>
          <div className={styles.previewOverlayHeader}>
            <div className={styles.previewOverlayCopy}>
              <div className={styles.panelEyebrow}>{t("authoring.topbar.previewEyebrow")}</div>
              <strong>{dashboard.dashboard_spec.dashboard.name}</strong>
            </div>
            <button
              type="button"
              className={`${styles.secondaryAction} ${styles.workspaceAction}`}
              onClick={() => setInlinePreview(null)}
            >
              {t("authoring.topbar.closePreview")}
            </button>
          </div>
          <div className={styles.previewOverlayFrame}>
            <ViewerApp
              previewDocument={inlinePreview.document}
              previewUpdatedAt={inlinePreview.savedAt}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
