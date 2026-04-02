"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
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
import { useI18n } from "../../i18n/i18n-context";
import { randomUuid } from "../../utils/random-uuid";
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
    updateDashboard,
    replaceDashboard,
    handleSaveDashboard,
    handlePublishDashboard,
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
    sessionId,
    replaceDashboard,
    runPreviewForDocument,
    onAppliedDashboard: (nextDashboard) => {
      setSelectedViewId(nextDashboard.dashboard_spec.views[0]?.id ?? null);
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
    selectedViewTemplateFields,
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
    handleFieldMappingChange,
    handleRunPreview,
    handleSaveDashboardAction,
    handlePublishDashboardAction,
    handleOpenViewIntervention,
    handleCloseAdvancedIntervention,
    handleClearViewFocus,
    handleCanvasEditView,
    handleStorePreview,
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

  const { canvasRef, startInteraction } = useCanvasInteraction({
    breakpoint,
    onSelectedViewIdChange: setSelectedViewId,
    onMobileLayoutModeChange: setMobileLayoutMode,
    dashboardRef,
    mobileLayoutModeRef,
    applyDashboardMutation,
    onInteractionCommit: handleCanvasInteractionCommit,
  });

  return (
    <div className={`${styles.shell} ${embedded ? styles.shellEmbedded : ""}`}>
      <header className={`${styles.topbar} ${embedded ? styles.topbarEmbedded : ""}`}>
        <div className={styles.brandBlock}>
          <div className={styles.brandEyebrow}>{t("authoring.topbar.eyebrow")}</div>
          <input
            className={styles.dashboardNameInput}
            value={dashboard.dashboard_spec.dashboard.name}
            onChange={(event) => handleDashboardNameChange(event.target.value)}
            aria-label={t("authoring.topbar.dashboardNameAria")}
          />
          <div className={styles.statusLine}>{storageMessage}</div>
        </div>

        <div className={styles.topbarActions}>
          <div className={`${styles.toolbarGroup} ${styles.toolbarGroupBack}`}>
            <Link
              href="/"
              className={`${styles.secondaryAction} ${styles.navAction}`}
            >
              {t("authoring.topbar.backHome")}
            </Link>
          </div>

          <span className={styles.toolbarDivider} aria-hidden="true" />

          <div className={`${styles.toolbarGroup} ${styles.toolbarGroupWorkspace}`}>
            <button
              type="button"
              className={`${styles.secondaryAction} ${styles.workspaceAction}`}
              disabled={!hydrated}
              onClick={() => void handleRunPreview()}
            >
              {t("authoring.topbar.runCheck")}
            </button>
            <button
              type="button"
              className={`${styles.secondaryAction} ${styles.workspaceAction}`}
              disabled={!hydrated}
              onClick={() => {
                const previewKey = handleStorePreview();
                window.open(`/viewer/preview?previewKey=${encodeURIComponent(previewKey)}`, "_blank", "noopener,noreferrer");
              }}
            >
              {t("authoring.topbar.openPreview")}
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
              onClick={() => void handlePublishDashboardAction()}
            >
              {publishInFlight ? t("common.loading") : t("authoring.topbar.publish")}
            </button>
          </div>

          <span className={styles.toolbarDivider} aria-hidden="true" />

          <div className={styles.toolbarGroup}>
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

          {embedded ? (
            <>
              <span className={styles.toolbarDivider} aria-hidden="true" />
              <div className={`${styles.toolbarGroup} ${styles.toolbarGroupNav}`}>
              <button
                type="button"
                className={`${styles.secondaryAction} ${styles.navAction}`}
                onClick={onToggleEmbeddedMenu}
              >
                {embeddedMenuCollapsed
                  ? t("authoring.topbar.showMenu")
                  : t("authoring.topbar.hideMenu")}
              </button>
            </div>
            </>
          ) : null}
        </div>
      </header>

      <div className={`${styles.workspace} ${embedded ? styles.workspaceEmbedded : ""}`}>
        <AuthoringCanvasPanel
          breakpointLabel={breakpoint === "desktop" ? "Desktop" : "Mobile"}
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
          onDeleteView={(viewId, viewTitle) => {
            if (window.confirm(t("authoring.topbar.deleteViewConfirm", { title: viewTitle }))) {
              handleDeleteView(viewId);
            }
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
              onFieldMappingChange={handleFieldMappingChange}
              selectedViewTemplateFields={selectedViewTemplateFields}
              onSaveDashboard={handleSaveDashboardAction}
              saveInFlight={saveInFlight}
              saveDisabled={!hydrated || publishInFlight}
              onClose={handleCloseAdvancedIntervention}
              styles={styles}
            />
          ) : null}
        </AuthoringCanvasPanel>

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
        />
      </div>
    </div>
  );
}
