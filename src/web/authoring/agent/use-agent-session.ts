"use client";

import { App } from "antd";
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
import { loadAuthoringAgentSession, steerAuthoringAgent } from "./agent-session-client";
import type {
  AuthoringModeSummary,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AgentStatus,
  AuthoringUiMessage,
} from "@/web/authoring/agent/types";
import type { AuthoringTaskPayload } from "@/ai/authoring/contracts/task-event";
import type { DashboardDocument } from "@/contracts";
import {
  findLatestAuthoringRoute,
  findLatestAuthoringMode,
  findLatestDraftOutput,
  findLatestApplyPatchOutput,
} from "@/web/authoring/agent/inspection";
import { pruneToolDashboardsAfterAppliedPatch } from "@/web/authoring/agent/message-prune";
import { finalizeIncompleteToolCalls } from "@/web/authoring/agent/incomplete-tools";
import type { PreviewRunResult } from "../hooks/use-authoring-controller";
import {
  projectAgentMessagesToUiMessages,
  reduceAgentEventToUiMessages,
} from "@/web/authoring/agent/agent-event-reducer";
import { dashboardDraftDocumentHash } from "@/web/authoring/api/dashboard-api";
import { inferAuthoringIntent } from "@/web/authoring/agent/intent-strategy";
import { runAuthoringAgentStream } from "@/web/authoring/agent/authoring-stream-runner";
import { useAuthoringApprovalFlow } from "@/web/authoring/agent/use-agent-approval-flow";

interface UseAuthoringAgentSessionInput {
  workspaceId: string;
  userId: string;
  dashboardRef: RefObject<DashboardDocument>;
  dashboardId: string;
  selectedViewId: string | null;
  chatSessionId: string;
  editingSessionId: string;
  isLocalNewChatSession?: boolean;
  getBaseVersion: () => number;
  replaceDashboard: (
    nextDashboard: DashboardDocument,
    options?: { previewPolicy?: "reset" | "rerun" | "preserve" },
  ) => void;
  runPreviewForDocument: (
    document: DashboardDocument,
    options?: {
      persistChecks?: boolean;
      mode?: "foreground" | "background";
      chatSessionId?: string | null;
    },
  ) => Promise<PreviewRunResult>;
  onAppliedDashboard: (
    document: DashboardDocument,
    focusedViewId?: string | null,
  ) => void;
}

const EMPTY_AGENT_MESSAGES: AuthoringUiMessage[] = [];

export function useAuthoringAgentSession({
  workspaceId,
  userId,
  dashboardRef,
  dashboardId,
  selectedViewId,
  chatSessionId,
  editingSessionId,
  isLocalNewChatSession = false,
  getBaseVersion,
  replaceDashboard,
  runPreviewForDocument,
  onAppliedDashboard,
}: UseAuthoringAgentSessionInput) {
  const { message } = App.useApp();
  const chatInstanceId = `${workspaceId}:${userId}:${dashboardId}:${chatSessionId}`;
  const [promptText, setPromptText] = useState("");
  /** 本地操作错误（发消息 / 批补丁失败等），在 AI dock 顶栏展示 */
  const [agentUiAlert, setAgentUiAlert] = useState<string | null>(null);
  const [authoringTask, setAuthoringTask] =
    useState<AuthoringTaskPayload | null>(null);
  const [agentMessages, setMessages] = useState<AuthoringUiMessage[]>(EMPTY_AGENT_MESSAGES);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("ready");
  const [agentError, setAgentError] = useState<Error | undefined>(undefined);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [locallyResolvedSuggestionIds, setLocallyResolvedSuggestionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const appliedSuggestionIdsRef = useRef<Set<string>>(new Set());
  type SessionStateCache = Map<string, { messages: AuthoringUiMessage[]; task: AuthoringTaskPayload | null }>;
  const sessionStateCacheRef = useRef<SessionStateCache>(new Map());

  function setCachedSessionState(
    cache: SessionStateCache,
    key: string,
    value: { messages: AuthoringUiMessage[]; task: AuthoringTaskPayload | null },
  ) {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > 10) {
      cache.delete(cache.keys().next().value as string);
    }
  }
  const previousAgentStatusRef = useRef<AgentStatus>("ready");
  const pendingApprovalEventRef = useRef<{
    proposalId: string;
    decision: "approve" | "reject";
    baseVersion: number;
    currentDocumentHash: string;
  } | null>(null);
  const requestBodyRef = useRef({
    workspaceId,
    userId,
    chatSessionId,
    editingSessionId,
    dashboardId,
    selectedViewId,
    dashboardRef,
    getBaseVersion,
  });

  requestBodyRef.current = {
    workspaceId,
    userId,
    chatSessionId,
    editingSessionId,
    dashboardId,
    selectedViewId,
    dashboardRef,
    getBaseVersion,
  };
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    appliedSuggestionIdsRef.current = new Set();
    setLocallyResolvedSuggestionIds(new Set());
  }, [chatInstanceId]);

  const clearAgentError = useCallback(() => setAgentError(undefined), []);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setMessages((current) => finalizeIncompleteToolCalls(current));
    setAgentStatus("ready");
  }, []);

  /**
   * Inject a mid-turn correction while the Agent is streaming.
   * This uses `agent.steer()` server-side – the message is delivered to
   * the Agent's current reasoning loop without waiting for the turn to end.
   * No-op if the Agent is not currently streaming.
   */
  const steerMessage = useCallback(
    async (text: string): Promise<void> => {
      if (agentStatus !== "streaming") return;
      const current = requestBodyRef.current;
      await steerAuthoringAgent({
        workspaceId: current.workspaceId,
        userId: current.userId,
        dashboardId: current.dashboardId,
        chatSessionId: current.chatSessionId,
        message: text,
      });
    },
    [agentStatus],
  );

  const sendMessage = useCallback(async (input: { text: string }) => {
    const current = requestBodyRef.current;
    if (!current.userId || !current.dashboardId) {
      throw new Error("Workspace user is still loading.");
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setAgentStatus("submitted");
    setAgentError(undefined);

    try {
      await runAuthoringAgentStream({
        signal: controller.signal,
        requestBody: {
          chatSessionId: current.chatSessionId,
          editingSessionId: current.editingSessionId,
          dashboardId: current.dashboardId,
          focusedViewId: current.selectedViewId,
          dashboard: current.dashboardRef.current,
          baseVersion: current.getBaseVersion(),
          approvalEvent: pendingApprovalEventRef.current,
          intent:
            pendingApprovalEventRef.current?.decision === "reject"
              ? "cancel"
              : pendingApprovalEventRef.current?.decision === "approve"
                ? "apply"
                : inferAuthoringIntent(input.text),
          messageText: input.text,
        },
        callbacks: {
          onOpen: () => {
            setAgentStatus("streaming");
          },
          onEvent: (event) => {
            setMessages((currentMessages) =>
              reduceAgentEventToUiMessages(currentMessages, event),
            );
          },
          onDone: () => {
            setAgentStatus("ready");
          },
          onAbort: () => {
            setMessages((current) => finalizeIncompleteToolCalls(current));
            setAgentStatus("ready");
          },
          onError: (error) => {
            setAgentError(error);
            setAgentStatus("error");
          },
        },
      });
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, []);

  const latestAuthoringRoute = useMemo(
    () => findLatestAuthoringRoute(agentMessages),
    [agentMessages],
  );
  const latestAuthoringMode = useMemo(
    () => findLatestAuthoringMode(agentMessages),
    [agentMessages],
  );
  const latestDraftOutput = useMemo(
    () => findLatestDraftOutput(agentMessages),
    [agentMessages],
  );
  const latestApplyPatchOutput = useMemo(
    () => findLatestApplyPatchOutput(agentMessages),
    [agentMessages],
  );
  const currentDocumentHash = dashboardDraftDocumentHash(dashboardRef.current);
  const showApprovalWarning = useCallback(
    (detail: string, duration: number) => {
      message.warning(detail, duration);
    },
    [message],
  );
  const {
    pendingPatchApproval,
    handleApprovePendingPatch,
    handleRejectPendingPatch,
  } = useAuthoringApprovalFlow({
    agentStatus,
    currentDocumentHash,
    latestDraftOutput,
    latestApplyPatchOutput,
    locallyResolvedSuggestionIds,
    dashboardRef,
    getBaseVersion,
    sendMessage,
    pendingApprovalEventRef,
    appliedSuggestionIdsRef,
    setLocallyResolvedSuggestionIds,
    setMessages,
    setAgentUiAlert,
    clearAgentError,
    setAgentError,
    setAgentStatus,
    showWarning: showApprovalWarning,
  });

  const refreshAuthoringTask = useCallback(async () => {
    if (!userId || !dashboardId) {
      return null;
    }
    return loadAuthoringTask({
      workspaceId,
      userId,
      dashboardId,
      chatSessionId,
    });
  }, [chatSessionId, dashboardId, userId, workspaceId]);

  useEffect(() => {
    let active = true;
    setSessionHydrated(false);
    if (!userId || !dashboardId) {
      setMessages([]);
      setAuthoringTask(null);
      setAgentUiAlert(null);
      setSessionHydrated(true);
      return () => {
        active = false;
      };
    }

    if (isLocalNewChatSession) {
      const emptyState = {
        messages: EMPTY_AGENT_MESSAGES,
        task: null,
      };
      setCachedSessionState(sessionStateCacheRef.current, chatInstanceId, emptyState);
      setMessages(emptyState.messages);
      setAuthoringTask(emptyState.task);
      setAgentUiAlert(null);
      setSessionHydrated(true);
      return () => {
        active = false;
      };
    }

    const cachedState = sessionStateCacheRef.current.get(chatInstanceId);
    if (cachedState) {
      setMessages(cachedState.messages);
      setAuthoringTask(cachedState.task);
      setAgentUiAlert(null);
      setSessionHydrated(true);
      return () => {
        active = false;
      };
    }

    void (async () => {
      const [restored, task] = await Promise.all([
        loadAuthoringAgentSession({
          workspaceId,
          userId,
          dashboardId,
          chatSessionId,
        }).catch(() => null),
        loadAuthoringTask({
          workspaceId,
          userId,
          dashboardId,
          chatSessionId,
        }).catch(() => null),
      ]);

      if (!active) {
        return;
      }

      const nextMessages = restored
        ? projectAgentMessagesToUiMessages(restored.messages)
        : EMPTY_AGENT_MESSAGES;
      const nextState = {
        messages: nextMessages,
        task,
      };
      setCachedSessionState(sessionStateCacheRef.current, chatInstanceId, nextState);
      setMessages(nextMessages);
      setAuthoringTask(task);
      setAgentUiAlert(null);
      setSessionHydrated(true);
    })();

    return () => {
      active = false;
    };
  }, [
    chatInstanceId,
    dashboardId,
    isLocalNewChatSession,
    userId,
    workspaceId,
  ]);

  useEffect(() => {
    if (!sessionHydrated || !userId || !dashboardId) {
      return undefined;
    }

    setCachedSessionState(sessionStateCacheRef.current, chatInstanceId, {
      messages: agentMessages,
      task: authoringTask,
    });
    return undefined;
  }, [
    agentMessages,
    authoringTask,
    chatInstanceId,
    dashboardId,
    sessionHydrated,
    userId,
  ]);

  useEffect(() => {
    const previousStatus = previousAgentStatusRef.current;
    previousAgentStatusRef.current = agentStatus;
    const wasBusy =
      previousStatus === "submitted" || previousStatus === "streaming";
    const isBusy = agentStatus === "submitted" || agentStatus === "streaming";
    if (!sessionHydrated || !wasBusy || isBusy) {
      return undefined;
    }

    let active = true;
    void refreshAuthoringTask()
      .then((task) => {
        if (!active) {
          return;
        }
        setAuthoringTask(task);
        setCachedSessionState(sessionStateCacheRef.current, chatInstanceId, {
          messages: agentMessages,
          task,
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    agentStatus,
    agentMessages,
    chatInstanceId,
    refreshAuthoringTask,
    sessionHydrated,
  ]);

  async function recordTaskEvent(input: {
    kind: "agent_request" | "mode_update" | "approval_requested" | "patch_applied" | "layout_intervention" | "contract_intervention" | "view_added" | "draft_saved" | "dashboard_published";
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
      chatSessionId,
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

  useEffect(() => {
    const output = latestApplyPatchOutput;
    const appliedDoc = output?.dashboard;
    const suggestionId = output?.suggestion_id;
    if (!output || !appliedDoc || !suggestionId) {
      return;
    }
    if (appliedSuggestionIdsRef.current.has(suggestionId)) {
      return;
    }

    appliedSuggestionIdsRef.current.add(suggestionId);
    setLocallyResolvedSuggestionIds((current) => new Set(current).add(suggestionId));
    replaceDashboard(appliedDoc);
    onAppliedDashboard(appliedDoc, output.focused_view_id ?? null);

    void (async () => {
      const base = `${output.title} approved and applied to the local draft. Save or publish explicitly when ready.`;
      if (output.kind !== "data" || appliedDoc.bindings.length === 0) {
        message.success(base, 4);
      } else {
        const previewResult = await runPreviewForDocument(appliedDoc, {
          persistChecks: true,
          chatSessionId,
        });
        const full = `${base} ${previewResult.message}`;
        message.success(full, Math.min(12, 4 + Math.ceil(full.length / 80)));
      }

      await recordTaskEvent({
        kind: "patch_applied",
        title: output.title,
        detail: output.summary,
        dedupeKey: `patch:${suggestionId}`,
        metadata: {
          suggestion_id: suggestionId,
          kind: output.kind,
        },
        patch: {
          dashboardName: appliedDoc.dashboard_spec.dashboard.name,
        },
      }).catch(() => undefined);

      setMessages((prev) => pruneToolDashboardsAfterAppliedPatch(prev, suggestionId));
    })();
  }, [
    latestApplyPatchOutput,
    chatSessionId,
    message,
    onAppliedDashboard,
    replaceDashboard,
    runPreviewForDocument,
  ]);

  async function handleGenerateAi() {
    const text = promptText.trim();
    if (!text || agentStatus === "submitted" || agentStatus === "streaming") {
      return;
    }

    setAgentUiAlert(null);
    clearAgentError();
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

  return {
    agentMessages,
    agentStatus,
    agentError,
    stopAgentGeneration: stop,
    steerMessage,
    promptText,
    setPromptText,
    agentUiAlert,
    authoringTask,
    authoringRoute: latestAuthoringRoute,
    authoringMode: latestAuthoringMode as AuthoringModeSummary | null,
    pendingPatchApproval,
    recordTaskEvent,
    handleGenerateAi,
    handleApprovePendingPatch,
    handleRejectPendingPatch,
  };
}
