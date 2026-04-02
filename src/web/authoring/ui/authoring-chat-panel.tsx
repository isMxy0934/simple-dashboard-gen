"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { useAiDockPosition } from "../hooks/use-ai-dock-position";
import type { DashboardAgentRouteDecision } from "@/ai/dashboard-agent/contracts/route";
import type {
  DashboardAgentDraftOutput,
  DashboardAgentWorkflowSummary,
  DashboardAgentMessage,
} from "@/ai/dashboard-agent/contracts/agent-contract";
import type { DashboardAgentTaskPayload } from "@/ai/dashboard-agent/contracts/task-state";
import { findLatestDraftOutput } from "@/ai/dashboard-agent/messages/message-inspection";
import type { PreviewState } from "@/web/authoring/state/preview-state";
import type { ValidationIssue } from "@/contracts/validation";
import { useI18n } from "../../i18n/i18n-context";
import {
  buildFallbackWorkflowStages,
  formatInterventionSummary,
  formatNextStepLabel,
  formatPersistedRuntimeStatus,
  formatPersistedTaskStatus,
  formatRepairSummary,
  formatRouteLabel,
  formatRuntimeCheckSummary,
  formatSkillLabel,
  formatTaskTimestamp,
  formatTaskTimelineStatus,
  formatWorkflowModeLabel,
  formatWorkflowStageStatus,
  formatWorkflowToolLabel,
  getFlowTimelineStatus,
  getInterventionTimelineStatus,
  getInterventionTimelineText,
  getTaskRecordTimelineStatus,
  getTaskTimelineNodeClassName,
  getRuntimeTimelineStatus,
  getRuntimeTimelineText,
  getWorkflowStageClassName,
  renderAuthoringMessageTimeline,
  type AgentGuidance,
  type InterventionControls,
  type WorkspaceSummary,
} from "../agent/chat-panel-helpers";

interface AuthoringChatPanelProps {
  agentMessages: DashboardAgentMessage[];
  agentGuidance: AgentGuidance;
  showAgentProcess: boolean;
  setShowAgentProcess: Dispatch<SetStateAction<boolean>>;
  previewState: PreviewState;
  previewMessage: string;
  agentError: Error | undefined;
  agentNotice: string;
  authoringRoute: DashboardAgentRouteDecision | null;
  authoringTask: DashboardAgentTaskPayload | null;
  authoringWorkflow: DashboardAgentWorkflowSummary | null;
  workspaceSummary: WorkspaceSummary;
  interventionControls: InterventionControls;
  pendingPatchApproval: {
    approvalId: string;
    draftOutput: DashboardAgentDraftOutput;
  } | null;
  onApprovePendingPatch: () => Promise<void>;
  onRejectPendingPatch: () => Promise<void>;
  validationIssues: ValidationIssue[];
  promptText: string;
  setPromptText: Dispatch<SetStateAction<string>>;
  agentStatus: "submitted" | "streaming" | "ready" | "error";
  onStop: () => void;
  onSend: () => Promise<void>;
  styles: Record<string, string>;
}

export function AuthoringChatPanel({
  agentMessages,
  agentGuidance,
  showAgentProcess,
  setShowAgentProcess,
  previewState,
  previewMessage,
  agentError,
  agentNotice,
  authoringRoute,
  authoringTask,
  authoringWorkflow,
  workspaceSummary,
  interventionControls,
  pendingPatchApproval,
  onApprovePendingPatch,
  onRejectPendingPatch,
  validationIssues,
  promptText,
  setPromptText,
  agentStatus,
  onStop,
  onSend,
  styles,
}: AuthoringChatPanelProps) {
  const { t, locale } = useI18n();
  const latestComposePatchOutput = findLatestDraftOutput(agentMessages);
  const activeIntervention = authoringTask?.intervention?.active
    ? authoringTask.intervention
    : null;
  const effectiveInterventionControls: InterventionControls = {
    ...interventionControls,
    selectedViewTitle:
      activeIntervention?.viewTitle ?? interventionControls.selectedViewTitle,
    isAdjustLayoutMode: Boolean(
      activeIntervention?.active && activeIntervention?.kind === "layout",
    ),
  };
  const activeWorkflowStage =
    authoringWorkflow?.active_stage ?? workspaceSummary.activeStage;
  const workflowStages =
    authoringWorkflow?.stages?.length
      ? authoringWorkflow.stages
      : buildFallbackWorkflowStages(activeWorkflowStage, t);
  const approvalRequired = Boolean(pendingPatchApproval);
  const approvalDraftOutput = pendingPatchApproval?.draftOutput ?? null;
  const approvalSuggestion = approvalDraftOutput?.suggestion ?? null;
  const runtimeSummaryOutput = approvalDraftOutput ?? latestComposePatchOutput;
  const flowTimelineStatus = getFlowTimelineStatus(authoringWorkflow);
  const runtimeTimelineStatus = getRuntimeTimelineStatus({
    activeStage: activeWorkflowStage,
    previewState,
    agentError,
    validationIssues,
    runtimeSummaryOutput,
  });
  const interventionTimelineStatus = getInterventionTimelineStatus(
    effectiveInterventionControls,
  );
  const taskRecordTimelineStatus = getTaskRecordTimelineStatus(authoringTask);
  const recentTaskEvents = authoringTask?.events.slice(-4).reverse() ?? [];
  const latestTaskEvent = recentTaskEvents[0] ?? null;
  /** Studio tab: 不包含「仅待审批」——审批关卡只在对话 Tab，避免误导用户去工作室找操作 */
  const studioTabNeedsAttention =
    Boolean(agentError) ||
    validationIssues.length > 0 ||
    Boolean(activeIntervention);
  const [isDockOpen, setIsDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState<"chat" | "studio">("chat");
  const approvalSectionRef = useRef<HTMLElement | null>(null);
  const lastScrolledApprovalIdRef = useRef<string | null>(null);
  const collapsed = !isDockOpen;
  const {
    position: dockPosition,
    dragging: dockDragging,
    beginDrag,
    onDragPointerMove,
    endDragCapsule,
    endDragHeader,
  } = useAiDockPosition(collapsed);
  const nextStep = authoringWorkflow?.active_stage ?? workspaceSummary.activeStage;
  const runtimeLabel = t(`authoring.chat.previewChip.${previewState}`);

  useEffect(() => {
    if (approvalSuggestion) {
      setDockTab("chat");
    }
  }, [approvalSuggestion]);

  useLayoutEffect(() => {
    const approvalId = pendingPatchApproval?.approvalId ?? null;
    if (!approvalId) {
      lastScrolledApprovalIdRef.current = null;
      return;
    }
    if (lastScrolledApprovalIdRef.current === approvalId) {
      return;
    }
    lastScrolledApprovalIdRef.current = approvalId;
    if (dockTab !== "chat") {
      return;
    }
    requestAnimationFrame(() => {
      approvalSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  }, [pendingPatchApproval?.approvalId, dockTab]);

  const dockRootStyle =
    dockPosition == null
      ? undefined
      : {
          left: dockPosition.x,
          top: dockPosition.y,
          right: "auto" as const,
          bottom: "auto" as const,
        };
  const dockAgentLive =
    agentStatus === "submitted" || agentStatus === "streaming";

  if (!isDockOpen) {
    return (
      <div
        className={`${styles.aiDockRoot} ${dockDragging ? styles.aiDockRootDragging : ""}`}
        style={dockRootStyle}
      >
        <aside className={`${styles.aiPanel} ${styles.aiPanelCollapsed}`}>
          <button
            type="button"
            className={`${styles.aiCapsule} ${styles.aiCapsuleCollapsed}`}
            data-activity={dockAgentLive ? "live" : undefined}
            aria-label={t("authoring.chat.openDockAria")}
            onPointerDown={(e) => beginDrag("capsule", e)}
            onPointerMove={onDragPointerMove}
            onPointerUp={(e) => endDragCapsule(e, () => setIsDockOpen(true))}
            onPointerCancel={(e) => endDragCapsule(e, () => setIsDockOpen(true))}
          >
            <span className={styles.aiCapsuleMark}>AI</span>
            <span className={styles.aiCapsuleDot} aria-hidden="true">
              {approvalRequired
                ? "!"
                : agentStatus === "submitted" || agentStatus === "streaming"
                  ? "•"
                  : ""}
            </span>
          </button>
        </aside>
      </div>
    );
  }

  return (
    <div
      className={`${styles.aiDockRoot} ${dockDragging ? styles.aiDockRootDragging : ""}`}
      style={dockRootStyle}
    >
      <aside className={styles.aiPanel} data-tab={dockTab}>
        <div className={styles.panelHeader}>
          <div
            className={styles.panelHeaderDrag}
            title={t("authoring.chat.dragHint")}
            onPointerDown={(e) => beginDrag("header", e)}
            onPointerMove={onDragPointerMove}
            onPointerUp={endDragHeader}
            onPointerCancel={endDragHeader}
          >
            <span className={styles.panelHeaderGrip} aria-hidden="true" />
            <strong className={styles.panelHeaderHeading}>AI</strong>
          </div>

          <div className={styles.panelHeaderActions}>
            <div className={styles.dockStatusLine} role="status">
              {approvalRequired ? (
                <span className={`${styles.dockStatusFlag} ${styles.dockStatusFlagApproval}`}>
                  {t("authoring.chat.dockStatusApproval")}
                </span>
              ) : null}
              {agentError || previewState === "error" ? (
                <span className={`${styles.dockStatusFlag} ${styles.dockStatusFlagUrgent}`}>
                  {t("authoring.chat.dockStatusError")}
                </span>
              ) : null}
              {agentStatus === "submitted" || agentStatus === "streaming" ? (
                <span className={`${styles.dockStatusFlag} ${styles.dockStatusFlagBusy}`}>
                  {t("authoring.chat.dockStatusBusy")}
                </span>
              ) : null}
              <span className={styles.dockStatusCore}>
                <span className={styles.dockStatusStep}>
                  {formatNextStepLabel(nextStep, t)}
                </span>
                <span className={styles.dockStatusSep} aria-hidden="true">
                  ·
                </span>
                <span className={styles.dockStatusPreview}>{runtimeLabel}</span>
                {effectiveInterventionControls.selectedViewTitle ? (
                  <>
                    <span className={styles.dockStatusSep} aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={styles.dockStatusViewTitle}
                      title={effectiveInterventionControls.selectedViewTitle}
                    >
                      {t("authoring.chat.dockStatusViewing", {
                        title: effectiveInterventionControls.selectedViewTitle,
                      })}
                    </span>
                  </>
                ) : null}
              </span>
            </div>
            <button
              type="button"
              className={styles.dockToggle}
              onClick={() => setIsDockOpen(false)}
            >
              {t("authoring.chat.close")}
            </button>
          </div>
        </div>

        <div className={styles.dockTabBar} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={dockTab === "chat"}
            className={`${styles.dockTab} ${dockTab === "chat" ? styles.dockTabActive : ""}`}
            onClick={() => setDockTab("chat")}
          >
            {t("authoring.chat.tabChat")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dockTab === "studio"}
            className={`${styles.dockTab} ${dockTab === "studio" ? styles.dockTabActive : ""} ${
              studioTabNeedsAttention ? styles.dockTabAttention : ""
            }`}
            onClick={() => setDockTab("studio")}
          >
            {t("authoring.chat.tabStudio")}
          </button>
        </div>

        <p className={styles.dockTabHint}>
          {dockTab === "chat"
            ? t("authoring.chat.tabHintChat")
            : t("authoring.chat.tabHintStudio")}
        </p>

        {dockTab === "chat" ? (
      <div className={styles.dockScrollable}>
        {agentNotice ? (
          <div className={styles.timelineInlineNotice}>{agentNotice}</div>
        ) : null}

        <div className={styles.chatBody}>
          <div className={styles.chatStream}>
            {agentMessages.length === 0 ? (
              <div className={styles.agentIntroCard}>
                <div className={styles.chatBubble}>
                  <strong>{t("authoring.chat.agent")}</strong>
                  <p>{agentGuidance.message}</p>
                </div>
              </div>
            ) : (
              renderAuthoringMessageTimeline({
                messages: agentMessages,
                showAgentProcess,
                classNames: styles,
                t,
                activeWorkflowStage,
                pendingPatchApprovalId:
                  pendingPatchApproval?.approvalId ?? null,
                approvalSectionRef,
                onApprovePendingPatch,
                onRejectPendingPatch,
              })
            )}
          </div>
        </div>
      </div>
        ) : (
          <div
            className={`${styles.dockScrollable} ${styles.dockScrollableStudio}`}
          >
            <p className={styles.studioExplainer}>{t("authoring.chat.studioExplainer")}</p>
            <div className={styles.studioTabMeta}>
              <span className={styles.metaChip}>
                {t("authoring.chat.modePrefix")}{" "}
                {formatWorkflowModeLabel(authoringWorkflow?.mode ?? "read", t)}
              </span>
              {latestTaskEvent ? (
                <span className={styles.metaChip}>
                  {t("authoring.chat.latestTask", { title: latestTaskEvent.title })}
                </span>
              ) : null}
            </div>

            <div className={styles.controlPlaneBody}>
            <section
              className={getTaskTimelineNodeClassName(flowTimelineStatus, styles)}
            >
              <div className={styles.taskTimelineNodeHeader}>
                <div className={styles.taskTimelineNodeTitle}>
                  <strong>{t("authoring.chat.aiPlan")}</strong>
                  <span>
                    {authoringWorkflow?.summary ?? t("authoring.chat.aiPlanFallback")}
                  </span>
                </div>
                <span className={styles.taskTimelineNodeStatus}>
                  {formatTaskTimelineStatus(flowTimelineStatus, t)}
                </span>
              </div>
              <div className={styles.workflowStageRail}>
                {workflowStages.map((stage, index) => (
                  <div
                    key={stage.id}
                    className={getWorkflowStageClassName(stage.status, styles)}
                  >
                    <div className={styles.workflowStageTop}>
                      <span className={styles.workflowStageIndex}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className={styles.workflowStageStatus}>
                        {formatWorkflowStageStatus(stage.status, t)}
                      </span>
                    </div>
                    <div className={styles.workflowStageTitle}>
                      <strong>{stage.title}</strong>
                      <span>{formatNextStepLabel(stage.id, t)}</span>
                    </div>
                    <p className={styles.workflowStageSummary}>{stage.description}</p>
                  </div>
                ))}
              </div>
            </section>

            <section
              className={getTaskTimelineNodeClassName(runtimeTimelineStatus, styles)}
            >
              <div className={styles.taskTimelineNodeHeader}>
                <div className={styles.taskTimelineNodeTitle}>
                  <strong>{t("authoring.chat.checksApproval")}</strong>
                  <span>
                    {getRuntimeTimelineText(
                      {
                        activeStage: activeWorkflowStage,
                        previewState,
                        previewMessage,
                        agentError,
                        validationIssues,
                        runtimeSummaryOutput,
                      },
                      t,
                    )}
                  </span>
                </div>
                <span className={styles.taskTimelineNodeStatus}>
                  {formatTaskTimelineStatus(runtimeTimelineStatus, t)}
                </span>
              </div>
              {agentError ? (
                <div className={styles.errorBanner}>{agentError.message}</div>
              ) : null}
              {runtimeSummaryOutput?.runtime_check ||
              runtimeSummaryOutput?.repair ||
              previewState !== "idle" ? (
                <div className={styles.suggestionList}>
                  {runtimeSummaryOutput?.runtime_check ? (
                    <div className={styles.suggestionItem}>
                      <strong>{t("authoring.chat.runtimeCheck")}</strong>
                      <span>
                        {formatRuntimeCheckSummary(runtimeSummaryOutput.runtime_check, t)}
                      </span>
                    </div>
                  ) : null}
                  {runtimeSummaryOutput?.repair ? (
                    <div className={styles.suggestionItem}>
                      <strong>{t("authoring.chat.repairLoop")}</strong>
                      <span>{formatRepairSummary(runtimeSummaryOutput.repair, t)}</span>
                    </div>
                  ) : null}
                  {previewState !== "idle" ? (
                    <div className={styles.suggestionItem}>
                      <strong>{t("authoring.chat.preview")}</strong>
                      <span>{previewMessage}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {validationIssues.length > 0 ? (
                <details className={styles.issueSummary}>
                  <summary>
                    {t("authoring.chat.validationIssues", {
                      count: validationIssues.length,
                    })}
                  </summary>
                  <div className={styles.issueListCompact}>
                    {validationIssues.slice(0, 4).map((issue) => (
                      <div key={`${issue.path}-${issue.message}`} className={styles.issueItem}>
                        <strong>{issue.path}</strong>
                        <span>{issue.message}</span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </section>

            <section
              className={getTaskTimelineNodeClassName(
                interventionTimelineStatus,
                styles,
              )}
            >
              <div className={styles.taskTimelineNodeHeader}>
                <div className={styles.taskTimelineNodeTitle}>
                  <strong>{t("authoring.chat.manualFallback")}</strong>
                  <span>
                    {getInterventionTimelineText(effectiveInterventionControls, t)}
                  </span>
                </div>
                <span className={styles.taskTimelineNodeStatus}>
                  {formatTaskTimelineStatus(interventionTimelineStatus, t)}
                </span>
              </div>
              <div className={styles.interventionMeta}>
                <div className={styles.interventionMetaItem}>
                  <strong>{t("authoring.chat.selectedView")}</strong>
                  <span>
                    {effectiveInterventionControls.selectedViewTitle ??
                      t("authoring.chat.selectViewHint")}
                  </span>
                </div>
                <div className={styles.interventionMetaItem}>
                  <strong>{t("authoring.chat.layoutMode")}</strong>
                  <span>
                    {effectiveInterventionControls.isAdjustLayoutMode
                      ? t("authoring.chat.layoutAgentLayoutAssist")
                      : t("authoring.chat.layoutCanvasAlways")}
                  </span>
                </div>
              </div>
              <div className={styles.panelActions}>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={interventionControls.onOpenViewIntervention}
                  disabled={!effectiveInterventionControls.selectedViewTitle}
                >
                  {t("authoring.chat.openViewContract")}
                </button>
              </div>
            </section>

            {authoringTask ? (
              <section
                className={getTaskTimelineNodeClassName(
                  taskRecordTimelineStatus,
                  styles,
                )}
              >
                <div className={styles.taskTimelineNodeHeader}>
                  <div className={styles.taskTimelineNodeTitle}>
                    <strong>{t("authoring.chat.recentActivity")}</strong>
                    <span>{t("authoring.chat.recentActivityHint")}</span>
                  </div>
                  <span className={styles.taskTimelineNodeStatus}>
                    {formatTaskTimelineStatus(taskRecordTimelineStatus, t)}
                  </span>
                </div>
                <div className={styles.suggestionList}>
                  <div className={styles.suggestionItem}>
                    <strong>{t("authoring.chat.status")}</strong>
                    <span>{formatPersistedTaskStatus(authoringTask.status, t)}</span>
                  </div>
                  <div className={styles.suggestionItem}>
                    <strong>{t("authoring.chat.runtime")}</strong>
                    <span>
                      {formatPersistedRuntimeStatus(authoringTask.runtimeStatus, t)}
                    </span>
                  </div>
                  <div className={styles.suggestionItem}>
                    <strong>{t("authoring.chat.lastSync")}</strong>
                    <span>{formatTaskTimestamp(authoringTask.updatedAt, locale, t)}</span>
                  </div>
                  {activeIntervention ? (
                    <div className={styles.suggestionItem}>
                      <strong>{t("authoring.chat.intervention")}</strong>
                      <span>{formatInterventionSummary(activeIntervention, t)}</span>
                    </div>
                  ) : null}
                </div>
                {recentTaskEvents.length > 0 ? (
                  <div className={styles.suggestionList}>
                    {recentTaskEvents.map((event) => (
                      <div key={event.id} className={styles.suggestionItem}>
                        <strong>{event.title}</strong>
                        <span>{event.detail}</span>
                        <span>{formatTaskTimestamp(event.createdAt, locale, t)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section
              className={getTaskTimelineNodeClassName(flowTimelineStatus, styles)}
            >
              <div className={styles.taskTimelineNodeHeader}>
                <div className={styles.taskTimelineNodeTitle}>
                  <strong>{t("authoring.chat.routeContext")}</strong>
                  <span>
                    {authoringRoute?.summary ?? t("authoring.chat.routeContextFallback")}
                  </span>
                </div>
                <span className={styles.taskTimelineNodeStatus}>
                  {formatRouteLabel(authoringRoute?.route ?? "chat", t)}
                </span>
              </div>
              {authoringRoute ? (
                <div className={styles.suggestionList}>
                  <div className={styles.suggestionItem}>
                    <strong>{t("authoring.chat.goal")}</strong>
                    <span>{authoringRoute.user_goal}</span>
                  </div>
                  <div className={styles.suggestionItem}>
                    <strong>{t("authoring.chat.route")}</strong>
                    <span>{formatRouteLabel(authoringRoute.route, t)}</span>
                  </div>
                </div>
              ) : null}
              <div className={styles.workflowMetaGrid}>
                <div className={styles.workflowMetaItem}>
                  <strong>{t("authoring.chat.activeTools")}</strong>
                  <div className={styles.workflowChipRow}>
                    {(authoringWorkflow?.active_tools?.length
                      ? authoringWorkflow.active_tools
                      : ["getViews"]
                    ).map((toolName) => (
                      <span key={toolName} className={styles.workflowChip}>
                        {formatWorkflowToolLabel(toolName, t)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className={styles.workflowMetaItem}>
                  <strong>{t("authoring.chat.skills")}</strong>
                  <div className={styles.workflowChipRow}>
                    {(authoringWorkflow?.skill_ids?.length
                      ? authoringWorkflow.skill_ids
                      : ["dashboard-authoring"]
                    ).map((skillId) => (
                      <span key={skillId} className={styles.workflowChipMuted}>
                        {formatSkillLabel(skillId)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <div className={styles.controlPlaneFooter}>
              <div className={styles.workflowMetaItem}>
                <strong>{t("authoring.chat.processVisibility")}</strong>
                <span>
                  {showAgentProcess
                    ? t("authoring.chat.processVisibleHint")
                    : t("authoring.chat.processHiddenHint")}
                </span>
              </div>
              <button
                type="button"
                className={styles.processToggle}
                onClick={() => setShowAgentProcess((current) => !current)}
              >
                {showAgentProcess
                  ? t("authoring.chat.hideAgentProcess")
                  : t("authoring.chat.showAgentProcess")}
              </button>
            </div>
          </div>
          </div>
        )}

      <div className={styles.chatInputArea}>
        <div className={styles.chatComposerShell}>
          <textarea
            className={styles.chatTextarea}
            rows={4}
            placeholder={agentGuidance.placeholder}
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return;
              }

              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void onSend();
              }
            }}
          />
          <button
            type="button"
            className={styles.sendButton}
            onClick={() => {
              if (agentStatus === "submitted" || agentStatus === "streaming") {
                onStop();
                return;
              }

              void onSend();
            }}
          >
            {agentStatus === "submitted" || agentStatus === "streaming"
              ? t("authoring.chat.stop")
              : t("authoring.chat.send")}
          </button>
        </div>
        <div className={styles.composerHint}>{t("authoring.chat.composerHint")}</div>
      </div>
      </aside>
    </div>
  );
}
