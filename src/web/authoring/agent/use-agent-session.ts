"use client";

import { App } from "antd";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
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
import { loadAuthoringAgentSession } from "./agent-session-client";
import type {
  AuthoringDraftOutput,
  AuthoringWorkflowSummary,
  AuthoringMessage,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringTaskPayload } from "@/ai/authoring/contracts/task-state";
import type { DashboardDocument } from "@/contracts";
import {
  findLatestAuthoringRoute,
  findLatestWorkflow,
  findLatestDraftOutput,
} from "@/ai/authoring/messages/inspection";
import { stripAuthoringMessagesForModel } from "@/ai/authoring/messages/client-parts";
import {
  pruneToolDashboardsAfterAppliedPatch,
  redactHeavyDashboardSnapshotsForTransport,
} from "@/ai/authoring/messages/message-prune";
import type { PreviewRunResult } from "../hooks/use-authoring-controller";
import { shouldRequestLocalPatchApproval } from "./approval-state";

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
  /** 本地操作错误（发消息 / 批补丁失败等），在 AI dock 顶栏展示 */
  const [agentUiAlert, setAgentUiAlert] = useState<string | null>(null);
  const [authoringTask, setAuthoringTask] =
    useState<AuthoringTaskPayload | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [locallyResolvedSuggestionIds, setLocallyResolvedSuggestionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const appliedSuggestionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    appliedSuggestionIdsRef.current = new Set();
    setLocallyResolvedSuggestionIds(new Set());
  }, [chatInstanceId]);

  const {
    messages: agentMessages,
    setMessages,
    sendMessage,
    stop,
    status: agentStatus,
    error: agentError,
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
        intent: null,
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
  });

  const latestAuthoringRoute = useMemo(
    () => findLatestAuthoringRoute(agentMessages),
    [agentMessages],
  );
  const latestAuthoringWorkflow = useMemo(
    () => findLatestWorkflow(agentMessages),
    [agentMessages],
  );
  const latestDraftOutput = useMemo(
    () => findLatestDraftOutput(agentMessages),
    [agentMessages],
  );
  const pendingPatchApproval = useMemo<PendingPatchApproval | null>(() => {
    if (!latestDraftOutput) {
      return null;
    }
    if (
      !shouldRequestLocalPatchApproval({
        latestDraftOutput,
        locallyResolvedSuggestionIds,
      })
    ) {
      return null;
    }

    return {
      approvalId: `local-${latestDraftOutput.suggestion.id}`,
      draftOutput: latestDraftOutput,
    };
  }, [latestDraftOutput, locallyResolvedSuggestionIds]);

  const refreshAuthoringTask = useCallback(async () => {
    return loadAuthoringTask({
      workspaceId,
      userId,
      dashboardId,
      sessionId,
    });
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
          setAgentUiAlert(null);
          setSessionHydrated(true);
          return;
        }

        setMessages(restored.messages);
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
    latestAuthoringWorkflow?.active_stage,
    latestAuthoringWorkflow?.summary,
    pendingPatchApproval?.approvalId,
    refreshAuthoringTask,
    sessionHydrated,
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
      const appliedDoc = pendingPatchApproval.draftOutput.suggestion.dashboard;
      const suggestionId = pendingPatchApproval.draftOutput.suggestion.id;
      if (!appliedDoc) {
        throw new Error("The staged patch did not include a dashboard snapshot to apply.");
      }

      if (appliedSuggestionIdsRef.current.has(suggestionId)) {
        return;
      }

      appliedSuggestionIdsRef.current.add(suggestionId);
      setLocallyResolvedSuggestionIds((current) => new Set(current).add(suggestionId));
      replaceDashboard(appliedDoc);
      onAppliedDashboard(appliedDoc, null);

      const base = `${pendingPatchApproval.draftOutput.suggestion.title} approved and applied to the local draft.`;
      if (pendingPatchApproval.draftOutput.suggestion.kind !== "data" || appliedDoc.bindings.length === 0) {
        message.success(base, 4);
      } else {
        const previewResult = await runPreviewForDocument(appliedDoc);
        const full = `${base} ${previewResult.message}`;
        message.success(full, Math.min(12, 4 + Math.ceil(full.length / 80)));
      }

      void recordTaskEvent({
        kind: "patch_applied",
        title: pendingPatchApproval.draftOutput.suggestion.title,
        detail: pendingPatchApproval.draftOutput.suggestion.summary,
        dedupeKey: `patch:${suggestionId}`,
        metadata: {
          suggestion_id: suggestionId,
          kind: pendingPatchApproval.draftOutput.suggestion.kind,
        },
        patch: {
          dashboardName: appliedDoc.dashboard_spec.dashboard.name,
        },
      }).catch(() => undefined);

      setMessages((prev) => pruneToolDashboardsAfterAppliedPatch(prev, suggestionId));
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
      const suggestionId = pendingPatchApproval.draftOutput.suggestion.id;
      setLocallyResolvedSuggestionIds((current) => new Set(current).add(suggestionId));
      setMessages((prev) => pruneToolDashboardsAfterAppliedPatch(prev, suggestionId));
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
