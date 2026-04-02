"use client";

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
  reportDashboardAgentTaskEvent,
} from "./agent-task-client";
import {
  loadAuthoringAgentSession,
  persistAuthoringAgentSession,
} from "./agent-session-client";
import type {
  DashboardAgentDraftOutput,
  DashboardAgentWorkflowSummary,
  DashboardAgentMessage,
} from "@/agent/dashboard-agent/contracts/agent-contract";
import type { DashboardAgentTaskPayload } from "@/agent/dashboard-agent/contracts/task-state";
import {
  DASHBOARD_AGENT_SESSION_PAYLOAD_VERSION,
  buildEmptyDashboardAgentSessionState,
  type DashboardAgentSessionPayload,
} from "@/agent/dashboard-agent/contracts/session-state";
import type { DashboardDocument } from "@/contracts";
import {
  findDraftOutputBySuggestionId,
  findLatestApplyPatchApproval,
  findLatestApplyPatchOutput,
  findLatestDashboardAgentRoute,
  findLatestWorkflow,
  findLatestDraftOutput,
} from "@/agent/dashboard-agent/messages/message-inspection";
import {
  stripDashboardAgentMessagesForModel,
  syncDashboardAgentPatchApprovalUi,
} from "@/agent/dashboard-agent/messages/client-parts";
import {
  pruneToolDashboardsAfterAppliedPatch,
  redactHeavyDashboardSnapshotsForTransport,
} from "@/agent/dashboard-agent/messages/message-prune";

interface UseAuthoringAgentSessionInput {
  dashboardRef: RefObject<DashboardDocument>;
  dashboardId?: string | null;
  sessionId: string;
  replaceDashboard: (nextDashboard: DashboardDocument, clearPreview?: boolean) => void;
  runPreviewForDocument: (document: DashboardDocument) => Promise<void>;
  onAppliedDashboard: (document: DashboardDocument) => void;
}

interface PendingPatchApproval {
  approvalId: string;
  draftOutput: DashboardAgentDraftOutput;
}

export function useAuthoringAgentSession({
  dashboardRef,
  dashboardId,
  sessionId,
  replaceDashboard,
  runPreviewForDocument,
  onAppliedDashboard,
}: UseAuthoringAgentSessionInput) {
  const [promptText, setPromptText] = useState("");
  const [showAgentProcess, setShowAgentProcess] = useState(false);
  const [agentNotice, setAgentNotice] = useState("");
  const [authoringTask, setAuthoringTask] =
    useState<DashboardAgentTaskPayload | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const appliedSuggestionIdsRef = useRef<Set<string>>(new Set());
  const pendingSessionPayloadRef =
    useRef<DashboardAgentSessionPayload | null>(null);
  const sessionPersistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    appliedSuggestionIdsRef.current = new Set();
  }, [sessionId]);

  const {
    messages: agentMessages,
    setMessages,
    sendMessage,
    stop,
    status: agentStatus,
    error: agentError,
    addToolApprovalResponse,
  } = useChat<DashboardAgentMessage>({
    id: sessionId,
    messages: [],
    resume: true,
    transport: new DefaultChatTransport({
      api: "/api/agent/chat",
      body: () => ({
        sessionId,
        dashboardId,
        dashboard: dashboardRef.current,
      }),
      prepareSendMessagesRequest: ({ messages, body, ...rest }) => ({
        ...rest,
        body: {
          ...body,
          messages: redactHeavyDashboardSnapshotsForTransport(
            stripDashboardAgentMessagesForModel(
              messages as DashboardAgentMessage[],
            ),
          ),
        },
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const latestDashboardAgentRoute = useMemo(
    () => findLatestDashboardAgentRoute(agentMessages),
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
    return loadAuthoringTask(sessionId);
  }, [sessionId]);

  const flushPersistedSession = useCallback(() => {
    const payload = pendingSessionPayloadRef.current;
    if (!payload) {
      return;
    }

    pendingSessionPayloadRef.current = null;
    void persistAuthoringAgentSession({
      sessionId,
      dashboardId,
      payload,
    }).catch(() => undefined);
  }, [dashboardId, sessionId]);

  useEffect(() => {
    let active = true;
    setSessionHydrated(false);

    void (async () => {
      try {
        const restored = await loadAuthoringAgentSession(sessionId);

        if (!active) {
          return;
        }

        if (!restored) {
          setMessages([]);
          const empty = buildEmptyDashboardAgentSessionState({
            sessionId,
            dashboardId,
          });
          setShowAgentProcess(empty.ui.showAgentProcess);
          setAgentNotice("");
          setSessionHydrated(true);
          return;
        }

        setMessages(restored.messages);
        setShowAgentProcess(restored.ui.showAgentProcess);
        setAgentNotice("");
        setSessionHydrated(true);
      } catch (error) {
        if (!active) {
          return;
        }

        setMessages([]);
        setAgentNotice("");
        setSessionHydrated(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [dashboardId, sessionId, setMessages]);

  useEffect(() => {
    if (!sessionHydrated) {
      return;
    }
    if (agentStatus === "submitted" || agentStatus === "streaming") {
      return;
    }
    const { messages: synced, changed } =
      syncDashboardAgentPatchApprovalUi(agentMessages);
    if (!changed) {
      return;
    }
    setMessages(synced);
  }, [agentMessages, agentStatus, sessionHydrated, setMessages]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const task = await loadAuthoringTask(sessionId);
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
  }, [sessionId]);

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

    const payload: DashboardAgentSessionPayload = {
      version: DASHBOARD_AGENT_SESSION_PAYLOAD_VERSION,
      sessionId,
      dashboardId: dashboardId ?? null,
      messages: agentMessages,
      ui: {
        showAgentProcess,
        agentNotice,
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
    agentNotice,
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
    replaceDashboard(appliedDoc);
    onAppliedDashboard(appliedDoc);
    setAgentNotice(
      `${latestApplyPatchOutput.title} approved and applied to the local draft.`,
    );

    if (latestApplyPatchOutput.kind === "data") {
      void runPreviewForDocument(appliedDoc);
    }

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
    setMessages,
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
    const nextTask = await reportDashboardAgentTaskEvent({
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

    setAgentNotice("");
    setPromptText("");

    try {
      await sendMessage({ text });
    } catch (error) {
      setPromptText(text);
      setAgentNotice(
        error instanceof Error ? error.message : "Agent request failed.",
      );
    }
  }

  async function handleApprovePendingPatch() {
    if (!pendingPatchApproval) {
      return;
    }

    setAgentNotice("");

    try {
      await addToolApprovalResponse({
        id: pendingPatchApproval.approvalId,
        approved: true,
      });
    } catch (error) {
      setAgentNotice(
        error instanceof Error ? error.message : "Unable to approve the staged patch.",
      );
    }
  }

  async function handleRejectPendingPatch() {
    if (!pendingPatchApproval) {
      return;
    }

    setAgentNotice("");

    try {
      await addToolApprovalResponse({
        id: pendingPatchApproval.approvalId,
        approved: false,
      });
    } catch (error) {
      setAgentNotice(
        error instanceof Error ? error.message : "Unable to reject the staged patch.",
      );
    }
  }

  return {
    agentMessages,
    agentStatus,
    agentError,
    stopAgentGeneration: stop,
    promptText,
    setPromptText,
    showAgentProcess,
    setShowAgentProcess,
    agentNotice,
    authoringTask,
    authoringRoute: latestDashboardAgentRoute,
    authoringWorkflow: latestAuthoringWorkflow as DashboardAgentWorkflowSummary | null,
    pendingPatchApproval,
    recordTaskEvent,
    handleGenerateAi,
    handleApprovePendingPatch,
    handleRejectPendingPatch,
  };
}
