"use client";

import { App } from "antd";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  loadAuthoringTask,
  reportAuthoringTaskEvent,
} from "./agent-task-client";
import {
  loadAuthoringAgentSession,
  persistAuthoringAgentSession,
} from "./agent-session-client";
import type {
  AuthoringDraftOutput,
  AuthoringIntent,
  AuthoringWorkflowSummary,
  AuthoringMessage,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringTaskPayload } from "@/ai/authoring/contracts/task-state";
import {
  AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
  buildEmptyAuthoringChatSessionState,
  type AuthoringChatSessionPayload,
} from "@/ai/authoring/contracts/session-state";
import type { DashboardDocument } from "@/contracts";
import {
  findDraftOutputBySuggestionId,
  findLatestApplyPatchApproval,
  findLatestApplyPatchOutput,
  findLatestAuthoringRoute,
  findLatestWorkflow,
  findLatestDraftOutput,
} from "@/ai/authoring/messages/inspection";
import {
  stripAuthoringMessagesForModel,
  syncAuthoringPatchApprovalUi,
} from "@/ai/authoring/messages/client-parts";
import {
  pruneToolDashboardsAfterAppliedPatch,
  redactHeavyDashboardSnapshotsForTransport,
} from "@/ai/authoring/messages/message-prune";
import type { PreviewRunResult } from "../hooks/use-authoring-controller";

interface UseAuthoringAgentSessionInput {
  workspaceId: string;
  userId: string;
  dashboardRef: RefObject<DashboardDocument>;
  dashboardId: string;
  selectedViewId: string | null;
  sessionId: string;
  replaceDashboard: (nextDashboard: DashboardDocument, clearPreview?: boolean) => void;
  runPreviewForDocument: (document: DashboardDocument) => Promise<PreviewRunResult>;
  onAppliedDashboard: (
    document: DashboardDocument,
    focusedViewId?: string | null,
  ) => void;
}

interface PendingPatchApproval {
  approvalId: string;
  draftOutput: AuthoringDraftOutput;
}

export function useAuthoringAgentSession({
  workspaceId,
  userId,
  dashboardRef,
  dashboardId,
  selectedViewId,
  sessionId,
  replaceDashboard,
  runPreviewForDocument,
  onAppliedDashboard,
}: UseAuthoringAgentSessionInput) {
  const { message } = App.useApp();
  const chatInstanceId = `${workspaceId}:${userId}:${dashboardId}:${sessionId}`;
  const [promptText, setPromptText] = useState("");
  /**
   * Explicit intent the UI has selected for the *next* outgoing message.
   * `null` means "let the backend keyword-detect intent from the user text".
   * The server-side `scope.ts` honors this via `intentSignal` and falls back
   * to its keyword catalog when null.
   */
  const [pendingIntent, setPendingIntent] = useState<AuthoringIntent | null>(null);
  const pendingIntentRef = useRef<AuthoringIntent | null>(null);
  useEffect(() => {
    pendingIntentRef.current = pendingIntent;
  }, [pendingIntent]);
  const [showAgentProcess, setShowAgentProcess] = useState(false);
  /** 本地操作错误（发消息 / 批补丁失败等），在 AI dock 顶栏展示 */
  const [agentUiAlert, setAgentUiAlert] = useState<string | null>(null);
  const [authoringTask, setAuthoringTask] =
    useState<AuthoringTaskPayload | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const appliedSuggestionIdsRef = useRef<Set<string>>(new Set());
  const pendingSessionPayloadRef =
    useRef<AuthoringChatSessionPayload | null>(null);
  const sessionPersistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    appliedSuggestionIdsRef.current = new Set();
  }, [chatInstanceId]);

  const {
    messages: agentMessages,
    setMessages,
    sendMessage,
    stop,
    status: agentStatus,
    error: agentError,
    addToolApprovalResponse,
  } = useChat<AuthoringMessage>({
    id: chatInstanceId,
    messages: [],
    resume: true,
    transport: new DefaultChatTransport({
      api: "/api/authoring/chat",
      body: () => ({
        workspaceId,
        userId,
        sessionId,
        dashboardId,
        focusedViewId: selectedViewId,
        dashboard: dashboardRef.current,
        // Read from ref so the latest UI selection wins even when body() is
        // called outside React's render phase (e.g. auto-send on approval
        // response).
        intent: pendingIntentRef.current,
      }),
      prepareSendMessagesRequest: ({ messages, body, ...rest }) => ({
        ...rest,
        body: {
          ...body,
          messages: redactHeavyDashboardSnapshotsForTransport(
            stripAuthoringMessagesForModel(
              messages as AuthoringMessage[],
            ),
          ),
        },
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const latestAuthoringRoute = useMemo(
    () => findLatestAuthoringRoute(agentMessages),
    [agentMessages],
  );
  const latestAuthoringWorkflow = useMemo(
    () => findLatestWorkflow(agentMessages),
    [agentMessages],
  );
  const latestApplyPatchOutput = useMemo(
    () => findLatestApplyPatchOutput(agentMessages),
    [agentMessages],
  );
  const pendingPatchApproval = useMemo<PendingPatchApproval | null>(() => {
    const pendingApproval = findLatestApplyPatchApproval(agentMessages);
    if (!pendingApproval) {
      return null;
    }

    const draftOutput = pendingApproval.suggestionId
      ? findDraftOutputBySuggestionId(agentMessages, pendingApproval.suggestionId)
      : findLatestDraftOutput(agentMessages);

    if (!draftOutput) {
      return null;
    }

    return {
      approvalId: pendingApproval.approvalId,
      draftOutput,
    };
  }, [agentMessages]);

  const refreshAuthoringTask = useCallback(async () => {
    return loadAuthoringTask({
      workspaceId,
      userId,
      dashboardId,
      sessionId,
    });
  }, [dashboardId, sessionId, userId, workspaceId]);

  const flushPersistedSession = useCallback(() => {
    const payload = pendingSessionPayloadRef.current;
    if (!payload) {
      return;
    }

    pendingSessionPayloadRef.current = null;
    void persistAuthoringAgentSession({
      workspaceId,
      userId,
      sessionId,
      dashboardId,
      payload,
    }).catch(() => undefined);
  }, [dashboardId, sessionId, userId, workspaceId]);

  useEffect(() => {
    let active = true;
    setSessionHydrated(false);

    void (async () => {
      try {
        const restored = await loadAuthoringAgentSession({
          workspaceId,
          userId,
          dashboardId,
          sessionId,
        });

        if (!active) {
          return;
        }

        if (!restored) {
          setMessages([]);
          const empty = buildEmptyAuthoringChatSessionState({
            sessionId,
            dashboardId,
          });
          setShowAgentProcess(empty.ui.showAgentProcess);
          setAgentUiAlert(null);
          setSessionHydrated(true);
          return;
        }

        setMessages(restored.messages);
        setShowAgentProcess(restored.ui.showAgentProcess);
        setAgentUiAlert(null);
        setSessionHydrated(true);
      } catch (error) {
        if (!active) {
          return;
        }

        setMessages([]);
        setAgentUiAlert(null);
        setSessionHydrated(true);
      }
    })();

    return () => {
      active = false;
    };
    // setMessages is intentionally omitted: useChat may return a new function
    // identity each render; including it retriggers hydration and
    // setSessionHydrated(false) in a loop (maximum update depth exceeded).
  }, [dashboardId, sessionId, userId, workspaceId]);

  useEffect(() => {
    if (!sessionHydrated) {
      return;
    }
    if (agentStatus === "submitted" || agentStatus === "streaming") {
      return;
    }
    const { messages: synced, changed } =
      syncAuthoringPatchApprovalUi(agentMessages);
    if (!changed) {
      return;
    }
    setMessages(synced);
  }, [agentMessages, agentStatus, sessionHydrated]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const task = await loadAuthoringTask({
          workspaceId,
          userId,
          dashboardId,
          sessionId,
        });
        if (active) {
          setAuthoringTask(task);
        }
      } catch {
        if (active) {
          setAuthoringTask(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [dashboardId, sessionId, userId, workspaceId]);

  useEffect(() => {
    if (!sessionHydrated) {
      return;
    }

    if (agentStatus === "submitted" || agentStatus === "streaming") {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const task = await refreshAuthoringTask();
        if (active) {
          setAuthoringTask(task);
        }
      } catch {
        return;
      }
    })();

    return () => {
      active = false;
    };
  }, [
    agentStatus,
    latestApplyPatchOutput?.suggestion_id,
    latestAuthoringWorkflow?.active_stage,
    latestAuthoringWorkflow?.summary,
    pendingPatchApproval?.approvalId,
    refreshAuthoringTask,
    sessionHydrated,
  ]);

  useEffect(() => {
    if (!sessionHydrated) {
      return;
    }

    const payload: AuthoringChatSessionPayload = {
      version: AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
      sessionId,
      dashboardId,
      messages: agentMessages,
      ui: {
        showAgentProcess,
        agentNotice: "",
      },
      prompt: {
        lastContextFingerprint: null,
        workingDraft: null,
        lastRunCheckState: null,
      },
      updatedAt: new Date().toISOString(),
    };

    pendingSessionPayloadRef.current = payload;

    if (sessionPersistTimerRef.current !== null) {
      window.clearTimeout(sessionPersistTimerRef.current);
      sessionPersistTimerRef.current = null;
    }

    if (agentStatus === "submitted" || agentStatus === "streaming") {
      return;
    }

    flushPersistedSession();
  }, [
    agentMessages,
    agentStatus,
    flushPersistedSession,
    dashboardId,
    sessionHydrated,
    sessionId,
    showAgentProcess,
  ]);

  useEffect(() => {
    return () => {
      if (sessionPersistTimerRef.current !== null) {
        window.clearTimeout(sessionPersistTimerRef.current);
        sessionPersistTimerRef.current = null;
      }
      flushPersistedSession();
    };
  }, [flushPersistedSession]);

  useEffect(() => {
    if (!latestApplyPatchOutput) {
      return;
    }

    if (appliedSuggestionIdsRef.current.has(latestApplyPatchOutput.suggestion_id)) {
      return;
    }

    const appliedDoc = latestApplyPatchOutput.dashboard;
    if (!appliedDoc) {
      return;
    }

    appliedSuggestionIdsRef.current.add(latestApplyPatchOutput.suggestion_id);
    setAgentUiAlert(null);
    replaceDashboard(appliedDoc);
    onAppliedDashboard(appliedDoc, latestApplyPatchOutput.focused_view_id ?? null);
    void (async () => {
      const base = `${latestApplyPatchOutput.title} approved and applied to the local draft.`;
      if (latestApplyPatchOutput.kind !== "data" || appliedDoc.bindings.length === 0) {
        message.success(base, 4);
        return;
      }

      const previewResult = await runPreviewForDocument(appliedDoc);
      const full = `${base} ${previewResult.message}`;
      message.success(full, Math.min(12, 4 + Math.ceil(full.length / 80)));
    })();

    void recordTaskEvent({
      kind: "patch_applied",
      title: latestApplyPatchOutput.title,
      detail: latestApplyPatchOutput.summary,
      dedupeKey: `patch:${latestApplyPatchOutput.suggestion_id}`,
      metadata: {
        suggestion_id: latestApplyPatchOutput.suggestion_id,
        kind: latestApplyPatchOutput.kind,
      },
      patch: {
        dashboardName: appliedDoc.dashboard_spec.dashboard.name,
      },
    }).catch(() => undefined);

    setMessages((prev) =>
      pruneToolDashboardsAfterAppliedPatch(prev, latestApplyPatchOutput.suggestion_id),
    );
  }, [
    latestApplyPatchOutput,
    onAppliedDashboard,
    replaceDashboard,
    runPreviewForDocument,
    selectedViewId,
  ]);

  async function recordTaskEvent(input: {
    kind: "agent_request" | "workflow_update" | "approval_requested" | "patch_applied" | "layout_intervention" | "contract_intervention" | "view_added" | "draft_saved" | "dashboard_published";
    title: string;
    detail: string;
    dedupeKey?: string;
      metadata?: Record<string, string | number | boolean | null>;
      patch?: {
        dashboardId?: string | null;
      dashboardName?: string;
      status?: string;
      summary?: string;
      currentGoal?: string;
      pendingApproval?: boolean;
      runtimeStatus?: string;
      intervention?: {
        kind: "layout" | "contract";
        active: boolean;
        viewId?: string | null;
        viewTitle?: string | null;
        updatedAt: string;
      } | null;
      updatedAt?: string;
    };
  }) {
    const nextTask = await reportAuthoringTaskEvent({
      workspaceId,
      userId,
      dashboardId,
      sessionId,
      event: {
        kind: input.kind,
        title: input.title,
        detail: input.detail,
        dedupeKey: input.dedupeKey,
        metadata: input.metadata,
      },
      patch: input.patch,
    });

    setAuthoringTask(nextTask);
    return nextTask;
  }

  async function handleGenerateAi() {
    const text = promptText.trim();
    if (!text || agentStatus === "submitted" || agentStatus === "streaming") {
      return;
    }

    setAgentUiAlert(null);
    setPromptText("");

    try {
      await sendMessage({ text });
    } catch (error) {
      setPromptText(text);
      const detail =
        error instanceof Error ? error.message : "Agent request failed.";
      setAgentUiAlert(detail);
    }
  }

  async function handleApprovePendingPatch() {
    if (!pendingPatchApproval) {
      return;
    }

    setAgentUiAlert(null);

    try {
      await addToolApprovalResponse({
        id: pendingPatchApproval.approvalId,
        approved: true,
      });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Unable to approve the staged patch.";
      setAgentUiAlert(detail);
    }
  }

  async function handleRejectPendingPatch() {
    if (!pendingPatchApproval) {
      return;
    }

    setAgentUiAlert(null);

    try {
      await addToolApprovalResponse({
        id: pendingPatchApproval.approvalId,
        approved: false,
      });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Unable to reject the staged patch.";
      setAgentUiAlert(detail);
    }
  }

  return {
    agentMessages,
    agentStatus,
    agentError,
    stopAgentGeneration: stop,
    promptText,
    setPromptText,
    pendingIntent,
    setPendingIntent,
    showAgentProcess,
    setShowAgentProcess,
    agentUiAlert,
    authoringTask,
    authoringRoute: latestAuthoringRoute,
    authoringWorkflow: latestAuthoringWorkflow as AuthoringWorkflowSummary | null,
    pendingPatchApproval,
    recordTaskEvent,
    handleGenerateAi,
    handleApprovePendingPatch,
    handleRejectPendingPatch,
  };
}
