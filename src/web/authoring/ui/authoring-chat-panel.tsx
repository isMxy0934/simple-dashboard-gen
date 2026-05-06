"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import type { AuthoringDraftOutput } from "@/ai/authoring/contracts/tool-io";
import type { AuthoringUiMessage } from "@/web/authoring/agent/types";
import type { AuthoringAgentSessionSummary } from "../agent/agent-session-client";
import {
  loadAuthoringAgentTrace,
  type AuthoringTraceSummaryEvent,
} from "../agent/agent-session-client";
import type { PreviewState } from "@/web/authoring/state/preview-state";
import { useI18n } from "../../i18n/i18n-context";
import {
  formatNextStepLabel,
  renderAuthoringUiMessageTimeline,
  type AgentGuidance,
  type WorkspaceSummary,
} from "../agent/chat-panel-helpers";
import {
  getAuthoringTerminalNotice,
  getAuthoringWorkingActivityFingerprint,
  getAuthoringWorkingIndicator,
} from "../agent/working-indicator";

interface AuthoringChatPanelProps {
  agentMessages: AuthoringUiMessage[];
  agentSessions: AuthoringAgentSessionSummary[];
  workspaceId: string;
  userId: string;
  dashboardId: string;
  currentSessionId: string;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  agentGuidance: AgentGuidance;
  previewState: PreviewState;
  previewMessage: string;
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

type DockIssue = {
  kind: "agent" | "operation" | "preview";
  source: string;
  detail: string;
  fullText: string;
};

type TraceTurnGroup = {
  key: string;
  label: string;
  events: AuthoringTraceSummaryEvent[];
  durationMs: number | null;
};

function compactIssueText(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 240);
}

function formatTraceElapsed(ms: number | null): string | null {
  if (typeof ms !== "number") {
    return null;
  }
  if (ms < 1000) {
    return `+${ms}ms`;
  }
  return `+${(ms / 1000).toFixed(1)}s`;
}

function formatTraceToolChoice(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "toolName" in value) {
    const toolName = (value as { toolName?: unknown }).toolName;
    return typeof toolName === "string" ? toolName : null;
  }
  return null;
}

function formatTraceArtifacts(event: AuthoringTraceSummaryEvent): string | null {
  const artifacts = event.artifacts;
  if (!artifacts) {
    return null;
  }
  const flags = [
    `Q:${artifacts.query ? "ok" : "no"}`,
    `V:${artifacts.view ? "ok" : "no"}`,
    `B:${artifacts.binding ? "ok" : "no"}`,
    `L:${artifacts.layout ? "ok" : "no"}`,
  ];
  if (artifacts.runtimeCheck) {
    flags.push(`check:${artifacts.runtimeCheck}`);
  }
  if (artifacts.patchComposed) {
    flags.push(artifacts.patchStale ? "patch:stale" : "patch:ready");
  }
  return flags.join(" ");
}

function groupTraceEvents(events: AuthoringTraceSummaryEvent[]): TraceTurnGroup[] {
  const groups = new Map<string, TraceTurnGroup>();
  for (const event of events) {
    const key = event.turnId ?? "session";
    const existing = groups.get(key);
    const label = event.turnIndex
      ? `Turn ${event.turnIndex}${event.turnLabel ? ` · ${event.turnLabel}` : ""}`
      : "Session";
    if (!existing) {
      groups.set(key, {
        key,
        label,
        events: [event],
        durationMs: event.elapsedMs,
      });
      continue;
    }
    existing.events.push(event);
    if (
      typeof event.elapsedMs === "number" &&
      (existing.durationMs === null || event.elapsedMs > existing.durationMs)
    ) {
      existing.durationMs = event.elapsedMs;
    }
  }
  return [...groups.values()];
}

export function AuthoringChatPanel({
  agentMessages,
  agentSessions,
  workspaceId,
  userId,
  dashboardId,
  currentSessionId,
  onNewSession,
  onSelectSession,
  agentGuidance,
  previewState,
  previewMessage,
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
  const activeModeStage = workspaceSummary.activeStage;
  const approvalRequired = Boolean(pendingPatchApproval);
  const chatStreamRef = useRef<HTMLDivElement | null>(null);
  const approvalSectionRef = useRef<HTMLElement | null>(null);
  const lastScrolledApprovalIdRef = useRef<string | null>(null);
  const lastDockIssueLogRef = useRef<string | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const requestedBottomScrollRef = useRef(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState<"chat" | "trace">("chat");
  const [traceEvents, setTraceEvents] = useState<AuthoringTraceSummaryEvent[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [activityNow, setActivityNow] = useState(() => Date.now());
  const [lastWorkingActivityAt, setLastWorkingActivityAt] = useState(() => Date.now());
  const nextStep = workspaceSummary.activeStage;
  const runtimeLabel = t(`authoring.chat.previewChip.${previewState}`);
  const agentBusy = agentStatus === "submitted" || agentStatus === "streaming";
  const dockIssue = useMemo<DockIssue | null>(() => {
    if (agentError) {
      const source = t("authoring.chat.dockIssueAgent");
      const detail = compactIssueText(
        agentError.message || t("authoring.chat.runtimeText.agentError"),
      );
      return {
        kind: "agent",
        source,
        detail,
        fullText: `${source}: ${detail}`,
      };
    }

    if (agentUiAlert) {
      const source = t("authoring.chat.dockIssueOperation");
      const detail = compactIssueText(agentUiAlert);
      return {
        kind: "operation",
        source,
        detail,
        fullText: `${source}: ${detail}`,
      };
    }

    if (previewState === "error") {
      const source = t("authoring.chat.dockIssuePreview");
      const detail = compactIssueText(
        previewMessage || t("authoring.chat.dockIssuePreviewFallback"),
      );
      return {
        kind: "preview",
        source,
        detail,
        fullText: `${source}: ${detail}`,
      };
    }

    return null;
  }, [agentError, agentUiAlert, previewMessage, previewState, t]);
  const workingActivityFingerprint = useMemo(
    () => getAuthoringWorkingActivityFingerprint(agentMessages),
    [agentMessages],
  );
  const workingIndicator = getAuthoringWorkingIndicator({
    messages: agentMessages,
    agentStatus,
    inactiveMs: agentBusy ? activityNow - lastWorkingActivityAt : 0,
  });
  const terminalNotice = getAuthoringTerminalNotice({
    messages: agentMessages,
    agentStatus,
  });
  const starterChips = [
    t("authoring.chat.starterChipHowToUse"),
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
  const traceTurnGroups = useMemo(
    () => groupTraceEvents(traceEvents),
    [traceEvents],
  );

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

  useEffect(() => {
    if (activePanelTab !== "trace" || !dashboardId || !currentSessionId) {
      return;
    }
    let cancelled = false;
    setTraceLoading(true);
    loadAuthoringAgentTrace({
      workspaceId,
      userId,
      dashboardId,
      sessionId: currentSessionId,
    })
      .then((events) => {
        if (!cancelled) {
          setTraceEvents(events);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTraceLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activePanelTab,
    agentMessages.length,
    agentStatus,
    currentSessionId,
    dashboardId,
    userId,
    workspaceId,
  ]);

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

  useEffect(() => {
    if (!agentBusy) {
      return;
    }
    const now = Date.now();
    setActivityNow(now);
    setLastWorkingActivityAt(now);
  }, [agentBusy, workingActivityFingerprint]);

  useEffect(() => {
    if (!agentBusy) {
      return;
    }
    const timer = window.setInterval(() => setActivityNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [agentBusy]);

  useEffect(() => {
    if (!dockIssue) {
      lastDockIssueLogRef.current = null;
      return;
    }

    const logKey = `${dockIssue.kind}:${previewState}:${dockIssue.detail}`;
    if (lastDockIssueLogRef.current === logKey) {
      return;
    }
    lastDockIssueLogRef.current = logKey;

    console.warn("[authoring-ui] dock issue", {
      kind: dockIssue.kind,
      source: dockIssue.source,
      detail: dockIssue.detail,
      previewState,
      previewMessage,
      agentStatus,
      activeStage: workspaceSummary.activeStage,
      dashboardName: workspaceSummary.dashboardName,
      viewCount: workspaceSummary.viewCount,
      bindingCount: workspaceSummary.bindingCount,
    });
  }, [
    agentStatus,
    dockIssue,
    previewMessage,
    previewState,
    workspaceSummary.activeStage,
    workspaceSummary.bindingCount,
    workspaceSummary.dashboardName,
    workspaceSummary.viewCount,
  ]);

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

  const capsuleBusy = agentBusy;
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
          aria-label={
            dockIssue
              ? `${t("authoring.chat.openDockAria")} ${dockIssue.fullText}`
              : t("authoring.chat.openDockAria")
          }
          title={dockIssue?.fullText}
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
                {dockIssue ? (
                  <span
                    className={`${styles.dockStatusFlag} ${styles.dockStatusFlagUrgent}`}
                    title={dockIssue.fullText}
                    aria-label={dockIssue.fullText}
                  >
                    {t("authoring.chat.dockStatusIssueSource", {
                      source: dockIssue.source,
                    })}
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

        <div className={styles.aiPanelTabs} role="tablist" aria-label={t("authoring.chat.tabListAria")}>
          <button
            type="button"
            role="tab"
            aria-selected={activePanelTab === "chat"}
            className={`${styles.aiPanelTab} ${activePanelTab === "chat" ? styles.aiPanelTabActive : ""}`}
            onClick={() => setActivePanelTab("chat")}
          >
            {t("authoring.chat.tabChat")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePanelTab === "trace"}
            className={`${styles.aiPanelTab} ${activePanelTab === "trace" ? styles.aiPanelTabActive : ""}`}
            onClick={() => setActivePanelTab("trace")}
          >
            {t("authoring.chat.tabTrace")}
          </button>
        </div>

        {dockIssue ? (
          <div
            className={styles.dockAlertBanner}
            role="alert"
            title={dockIssue.fullText}
          >
            <strong className={styles.dockAlertTitle}>
              {dockIssue.source}
            </strong>
            <span className={styles.dockAlertDetail}>{dockIssue.detail}</span>
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
            {activePanelTab === "trace" ? (
              <section className={styles.tracePanel}>
                <div className={styles.tracePanelHeader}>
                  <strong>{t("authoring.chat.traceTitle")}</strong>
                  <span>
                    {traceLoading
                      ? t("authoring.chat.traceLoading")
                      : t("authoring.chat.traceEventCount", {
                          count: traceEvents.length,
                        })}
                  </span>
                </div>
                <div className={styles.traceTimeline}>
                  {traceEvents.length === 0 ? (
                    <p className={styles.traceEmpty}>{t("authoring.chat.traceEmpty")}</p>
                  ) : (
                    traceTurnGroups.map((group, groupIndex) => (
                      <details
                        key={group.key}
                        className={styles.traceTurnGroup}
                      >
                        <summary className={styles.traceTurnSummary}>
                          <strong>{group.label}</strong>
                          <span>
                            {group.events.length} events
                            {formatTraceElapsed(group.durationMs)
                              ? ` · ${formatTraceElapsed(group.durationMs)}`
                              : ""}
                          </span>
                        </summary>
                        <div className={styles.traceTurnEvents}>
                          {group.events.map((event) => {
                            const elapsed = formatTraceElapsed(event.elapsedMs);
                            const toolChoice = formatTraceToolChoice(event.toolChoice);
                            const toolCalls = event.toolCalls?.map((call) => call.toolName).join(", ");
                            const failedResults = event.toolResults
                              ?.filter((result) => result.hasError)
                              .map((result) => result.toolName)
                              .join(", ");
                            const schemaTarget = event.context?.schemaLoadedFor
                              ? [
                                  event.context.schemaLoadedFor.datasourceId,
                                  event.context.schemaLoadedFor.table,
                                ].filter(Boolean).join("/")
                              : null;
                            const artifactFacts = formatTraceArtifacts(event);

                            return (
                              <details key={`${event.seq}-${event.event}`} className={styles.traceEvent}>
                                <summary className={styles.traceEventSummary}>
                                  <span>{new Date(event.ts).toLocaleTimeString()}</span>
                                  <strong>{event.event}</strong>
                                  <span>
                                    {event.stepNumber !== null && event.stepNumber !== undefined
                                      ? `Step ${event.stepNumber}`
                                      : event.mode ?? event.scope}
                                    {elapsed ? ` · ${elapsed}` : ""}
                                  </span>
                                </summary>
                                <div className={styles.traceEventDetails}>
                                  <p>{event.summary}</p>
                                  <div className={styles.traceEventFacts}>
                                    {event.mode ? <span>mode:{event.mode}</span> : null}
                                    {event.actionKind ? <span>action:{event.actionKind}</span> : null}
                                    {event.toolName ? <span>tool:{event.toolName}</span> : null}
                                    {toolChoice ? <span>choice:{toolChoice}</span> : null}
                                    {event.activeTools?.length ? (
                                      <span title={event.activeTools.join(", ")}>
                                        tools:{event.activeTools.length}
                                      </span>
                                    ) : null}
                                    {toolCalls ? <span>called:{toolCalls}</span> : null}
                                    {failedResults ? <span>failed:{failedResults}</span> : null}
                                    {typeof event.context?.datasourcesLoaded === "boolean" ? (
                                      <span>datasources:{event.context.datasourcesLoaded ? "loaded" : "needed"}</span>
                                    ) : null}
                                    {schemaTarget ? <span>schema:{schemaTarget}</span> : null}
                                    {artifactFacts ? <span>{artifactFacts}</span> : null}
                                    {event.activeGoalStatus ? <span>goal:{event.activeGoalStatus}</span> : null}
                                    {event.failureReason ? <span>reason:{event.failureReason}</span> : null}
                                  </div>
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      </details>
                    ))
                  )}
                </div>
              </section>
            ) : (
              <>
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
                  <>
                    {renderAuthoringUiMessageTimeline({
                      messages: agentMessages,
                      showAgentProcess: false,
                      classNames: styles,
                      t,
                      activeModeStage,
                      pendingPatchApproval,
                      agentStatus,
                      approvalSectionRef,
                      onApprovePendingPatch,
                      onRejectPendingPatch,
                    })}
                    {workingIndicator ? (
                      <div
                        className={styles.agentWorkingBubble}
                        role="status"
                        aria-live="polite"
                      >
                        <span className={styles.agentWorkingDots} aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                        <span>{t(`authoring.chat.working.${workingIndicator}`)}</span>
                      </div>
                    ) : null}
                    {!workingIndicator && terminalNotice ? (
                      <div
                        className={styles.agentWorkingBubble}
                        role="status"
                        aria-live="polite"
                      >
                        <span>{t(`authoring.chat.terminal.${terminalNotice}`)}</span>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
              </>
            )}
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
