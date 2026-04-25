"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import type {
  AuthoringDraftOutput,
  AuthoringMessage,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringAgentSessionSummary } from "../agent/agent-session-client";
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
  agentSessions: AuthoringAgentSessionSummary[];
  currentSessionId: string;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
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
  agentSessions,
  currentSessionId,
  onNewSession,
  onSelectSession,
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
  const chatStreamRef = useRef<HTMLDivElement | null>(null);
  const approvalSectionRef = useRef<HTMLElement | null>(null);
  const lastScrolledApprovalIdRef = useRef<string | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const requestedBottomScrollRef = useRef(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const nextStep = workspaceSummary.activeStage;
  const runtimeLabel = t(`authoring.chat.previewChip.${previewState}`);
  const starterChips = [
    t("authoring.chat.starterChipExploreData"),
    t("authoring.chat.starterChipClarifyMetrics"),
    t("authoring.chat.starterChipPasteSql"),
  ];
  const sessionOptions = agentSessions.some(
    (session) => session.sessionId === currentSessionId,
  )
    ? agentSessions
    : [
        {
          sessionId: currentSessionId,
          title: t("authoring.chat.currentSessionFallback"),
          messageCount: agentMessages.length,
          updatedAt: "",
        },
        ...agentSessions,
      ];

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const stream = chatStreamRef.current;
    if (!stream) {
      return;
    }

    requestAnimationFrame(() => {
      stream.scrollTo({
        top: stream.scrollHeight,
        behavior,
      });
      shouldStickToBottomRef.current = true;
    });
  }, []);

  const handleChatScroll = useCallback(() => {
    const stream = chatStreamRef.current;
    if (!stream) {
      return;
    }

    const distanceToBottom =
      stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    shouldStickToBottomRef.current = distanceToBottom <= 80;
  }, []);

  const handleSendPrompt = useCallback(() => {
    requestedBottomScrollRef.current = true;
    shouldStickToBottomRef.current = true;
    scrollChatToBottom("smooth");
    void onSend();
  }, [onSend, scrollChatToBottom]);

  useLayoutEffect(() => {
    if (
      !requestedBottomScrollRef.current &&
      !shouldStickToBottomRef.current
    ) {
      return;
    }

    const behavior = requestedBottomScrollRef.current ? "smooth" : "auto";
    requestedBottomScrollRef.current = false;
    scrollChatToBottom(behavior);
  }, [agentMessages, agentStatus, scrollChatToBottom]);

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
        </div>

        <div className={styles.panelSessionRow}>
          <div className={styles.sessionSwitcher}>
            <select
              className={styles.sessionSelect}
              value={currentSessionId}
              aria-label={t("authoring.chat.sessionSelectAria")}
              onChange={(event) => onSelectSession(event.target.value)}
            >
              {sessionOptions.map((session) => (
                <option key={session.sessionId} value={session.sessionId}>
                  {session.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.sessionNewButton}
              onClick={onNewSession}
            >
              {t("authoring.chat.newSession")}
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
              <div
                ref={chatStreamRef}
                className={styles.chatStream}
                onScroll={handleChatScroll}
              >
                {agentMessages.length === 0 ? (
                  <div className={styles.agentIntroCard}>
                    <section
                      className={styles.chatStarterPanel}
                      aria-label={t("authoring.chat.starterPromptLabel")}
                    >
                      <strong>{t("authoring.chat.agent")}</strong>
                      <p>{agentGuidance.message}</p>
                      <div className={styles.chatStarterChipList}>
                        {starterChips.map((chip) => (
                          <button
                            key={chip}
                            type="button"
                            className={styles.chatStarterChip}
                            onClick={() => setPromptText(chip)}
                          >
                            {chip}
                          </button>
                        ))}
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
        <div
          className={`${styles.chatComposerShell} ${
            composerExpanded ? styles.chatComposerShellExpanded : ""
          }`}
        >
          <div className={styles.chatTextareaWrap}>
            <textarea
              className={styles.chatTextarea}
              rows={composerExpanded ? 7 : 2}
              placeholder={agentGuidance.placeholder}
              value={promptText}
              onChange={(event) => setPromptText(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) {
                  return;
                }

                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSendPrompt();
                }
              }}
            />
            <button
              type="button"
              className={styles.composerExpandButton}
              aria-label={
                composerExpanded
                  ? t("authoring.chat.collapseComposer")
                  : t("authoring.chat.expandComposer")
              }
              title={
                composerExpanded
                  ? t("authoring.chat.collapseComposer")
                  : t("authoring.chat.expandComposer")
              }
              onClick={() => setComposerExpanded((current) => !current)}
            >
              {composerExpanded ? "↙" : "↗"}
            </button>
          </div>
          <button
            type="button"
            className={styles.sendButton}
            onClick={() => {
              if (agentStatus === "submitted" || agentStatus === "streaming") {
                onStop();
                return;
              }

              handleSendPrompt();
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
