"use client";

import {
  useLayoutEffect,
  useRef,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import type {
  AuthoringDraftOutput,
  AuthoringMessage,
} from "@/ai/authoring/contracts/tool-io";
import type { PreviewState } from "@/web/authoring/state/preview-state";
import { useI18n } from "../../i18n/i18n-context";
import {
  formatNextStepLabel,
  renderAuthoringMessageTimeline,
  type AgentGuidance,
  type WorkspaceSummary,
} from "../agent/chat-panel-helpers";

interface AuthoringChatPanelProps {
  agentMessages: AuthoringMessage[];
  agentGuidance: AgentGuidance;
  previewState: PreviewState;
  agentError: Error | undefined;
  agentUiAlert: string | null;
  workspaceSummary: WorkspaceSummary;
  focusedViewProgress: {
    title: string;
    steps: Array<{
      id: "appearance" | "query" | "binding" | "verified";
      done: boolean;
    }>;
  } | null;
  /** Canvas-selected view title for agent context (badge). */
  canvasFocusTitle: string | null;
  onClearCanvasFocus: () => void;
  pendingPatchApproval: {
    approvalId: string;
    draftOutput: AuthoringDraftOutput;
  } | null;
  onApprovePendingPatch: () => Promise<void>;
  onRejectPendingPatch: () => Promise<void>;
  promptText: string;
  setPromptText: Dispatch<SetStateAction<string>>;
  agentStatus: "submitted" | "streaming" | "ready" | "error";
  onStop: () => void;
  onSend: () => Promise<void>;
  styles: Record<string, string>;
  dockCollapsed: boolean;
  onToggleDock: () => void;
  onExpandDock: () => void;
  beginDockDrag: (
    kind: "capsule" | "header",
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onDockPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  endDockCapsule: (
    event: ReactPointerEvent<HTMLElement>,
    onOpen: () => void,
  ) => void;
  endDockHeader: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function AuthoringChatPanel({
  agentMessages,
  agentGuidance,
  previewState,
  agentError,
  agentUiAlert,
  workspaceSummary,
  focusedViewProgress,
  canvasFocusTitle,
  onClearCanvasFocus,
  pendingPatchApproval,
  onApprovePendingPatch,
  onRejectPendingPatch,
  promptText,
  setPromptText,
  agentStatus,
  onStop,
  onSend,
  styles,
  dockCollapsed,
  onToggleDock,
  onExpandDock,
  beginDockDrag,
  onDockPointerMove,
  endDockCapsule,
  endDockHeader,
}: AuthoringChatPanelProps) {
  const { t } = useI18n();
  const activeWorkflowStage = workspaceSummary.activeStage;
  const approvalRequired = Boolean(pendingPatchApproval);
  const approvalSectionRef = useRef<HTMLElement | null>(null);
  const lastScrolledApprovalIdRef = useRef<string | null>(null);
  const nextStep = workspaceSummary.activeStage;
  const runtimeLabel = t(`authoring.chat.previewChip.${previewState}`);
  const starterPrompts = [
    t("authoring.chat.starterPromptSales"),
    t("authoring.chat.starterPromptOps"),
    t("authoring.chat.starterPromptSql"),
  ];

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
    requestAnimationFrame(() => {
      approvalSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  }, [pendingPatchApproval?.approvalId]);

  const capsuleBusy =
    agentStatus === "submitted" || agentStatus === "streaming";
  const capsuleAttention =
    approvalRequired ||
    Boolean(agentError) ||
    Boolean(agentUiAlert) ||
    previewState === "error" ||
    capsuleBusy;

  if (dockCollapsed) {
    return (
      <div className={styles.aiPanelShellFloating}>
        <button
          type="button"
          className={`${styles.aiCapsule} ${styles.aiCapsuleCollapsed}`}
          data-activity={capsuleBusy ? "live" : undefined}
          onPointerDown={(event) => beginDockDrag("capsule", event)}
          onPointerMove={onDockPointerMove}
          onPointerUp={(event) => endDockCapsule(event, onExpandDock)}
          onPointerCancel={(event) => endDockCapsule(event, onExpandDock)}
          aria-label={t("authoring.chat.openDockAria")}
        >
          <span className={styles.aiCapsuleMark}>AI</span>
          {capsuleAttention ? (
            <span className={styles.aiCapsuleDot} aria-hidden="true" />
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.aiPanelShellFloating}>
      <aside className={styles.aiPanel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelHeaderRow}>
            <div
              className={styles.panelHeaderDrag}
              onPointerDown={(event) => beginDockDrag("header", event)}
              onPointerMove={onDockPointerMove}
              onPointerUp={(event) => endDockHeader(event)}
              onPointerCancel={(event) => endDockHeader(event)}
            >
              <span className={styles.panelHeaderGrip} aria-hidden="true" />
              <div className={styles.panelHeaderTitleBlock}>
                <strong className={styles.panelHeaderHeading}>
                  {t("authoring.chat.dockPanelTitle")}
                </strong>
              </div>
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
                {canvasFocusTitle ? (
                  <>
                    <span className={styles.dockStatusSep} aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={styles.dockStatusViewTitle}
                      title={canvasFocusTitle}
                    >
                      {t("authoring.chat.dockStatusViewing", {
                        title: canvasFocusTitle,
                      })}
                    </span>
                  </>
                ) : null}
              </span>
            </div>
            <button
              type="button"
              className={styles.dockToggle}
              onClick={onToggleDock}
              aria-label={t("authoring.chat.minimizeDockAria")}
              title={t("authoring.chat.minimizeDock")}
            >
              {t("authoring.chat.minimizeDock")}
            </button>
          </div>
          </div>
          {agentUiAlert ? (
            <div
              className={styles.dockAlertBanner}
              role="alert"
              title={agentUiAlert}
            >
              {agentUiAlert}
            </div>
          ) : null}
        </div>

        <div className={styles.aiPanelMain}>
        {canvasFocusTitle ? (
          <div className={styles.focusContextBanner}>
            <span>{t("authoring.chat.focusContextBanner", { title: canvasFocusTitle })}</span>
            <button
              type="button"
              className={styles.focusContextClear}
              onClick={onClearCanvasFocus}
            >
              {t("authoring.chat.focusContextClear")}
            </button>
          </div>
        ) : null}

          <div className={styles.dockScrollable}>
            {focusedViewProgress ? (
              <section className={styles.focusCard}>
                <div className={styles.focusCardHeader}>
                  <strong>
                    {t("authoring.chat.focusCardTitle", {
                      title: focusedViewProgress.title,
                    })}
                  </strong>
                  <span>{t("authoring.chat.focusCardHint")}</span>
                </div>
                <div className={styles.focusStepList}>
                  {focusedViewProgress.steps.map((step) => (
                    <div key={step.id} className={styles.focusStepItem}>
                      <span className={step.done ? styles.focusStepDone : styles.focusStepTodo}>
                        {step.done ? "✓" : "·"}
                      </span>
                      <span>{t(`authoring.chat.focusStep.${step.id}`)}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <div className={styles.chatBody}>
              <div className={styles.chatStream}>
                {agentMessages.length === 0 ? (
                  <div className={styles.agentIntroCard}>
                    <div className={styles.chatBubble}>
                      <strong>{t("authoring.chat.agent")}</strong>
                      <p>{agentGuidance.message}</p>
                    </div>
                    <section
                      className={styles.chatStarterPanel}
                      aria-label={t("authoring.chat.starterPromptLabel")}
                    >
                      <div className={styles.chatStarterPromptList}>
                        {starterPrompts.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            className={styles.chatStarterPromptButton}
                            onClick={() => setPromptText(prompt)}
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                      <div className={styles.chatStarterStepList}>
                        <span>{t("authoring.chat.starterStepGoal")}</span>
                        <span>{t("authoring.chat.starterStepData")}</span>
                        <span>{t("authoring.chat.starterStepApprove")}</span>
                      </div>
                    </section>
                  </div>
                ) : (
                  renderAuthoringMessageTimeline({
                    messages: agentMessages,
                    showAgentProcess: false,
                    classNames: styles,
                    t,
                    activeWorkflowStage,
                    pendingPatchApproval,
                    approvalSectionRef,
                    onApprovePendingPatch,
                    onRejectPendingPatch,
                  })
                )}
              </div>
            </div>
          </div>
        </div>

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
