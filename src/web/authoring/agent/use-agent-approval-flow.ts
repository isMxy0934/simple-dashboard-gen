"use client";

import {
  useCallback,
  useMemo,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { AuthoringDraftOutput } from "@/ai/authoring/contracts/tool-io";
import type { DashboardDocument } from "@/contracts";
import type {
  AgentStatus,
  AuthoringUiMessage,
} from "@/web/authoring/agent/types";
import { shouldRequestLocalPatchApproval } from "@/web/authoring/agent/approval-state";
import { pruneResolvedPatchProposalPayloads } from "@/web/authoring/agent/message-prune";
import { dashboardDraftDocumentHash } from "@/web/authoring/api/dashboard-api";

export interface PendingPatchApproval {
  approvalId: string;
  draftOutput: AuthoringDraftOutput;
}

interface PendingApprovalEvent {
  proposalId: string;
  decision: "approve" | "reject";
  baseVersion: number;
  currentDocumentHash: string;
}

export function useAuthoringApprovalFlow(input: {
  agentStatus: AgentStatus;
  latestDraftOutput: AuthoringDraftOutput | null;
  latestApplyPatchOutput: { suggestion_id?: string | null } | null;
  locallyResolvedSuggestionIds: Set<string>;
  currentDocumentHash: string;
  dashboardRef: RefObject<DashboardDocument>;
  getBaseVersion: () => number;
  sendMessage: (input: { text: string }) => Promise<void>;
  pendingApprovalEventRef: RefObject<PendingApprovalEvent | null>;
  appliedSuggestionIdsRef: RefObject<Set<string>>;
  setLocallyResolvedSuggestionIds: Dispatch<SetStateAction<Set<string>>>;
  setMessages: Dispatch<SetStateAction<AuthoringUiMessage[]>>;
  setAgentUiAlert: Dispatch<SetStateAction<string | null>>;
  clearAgentError: () => void;
  setAgentError: Dispatch<SetStateAction<Error | undefined>>;
  setAgentStatus: Dispatch<SetStateAction<AgentStatus>>;
  showWarning: (message: string, durationSeconds: number) => void;
}) {
  const {
    agentStatus,
    latestDraftOutput,
    latestApplyPatchOutput,
    locallyResolvedSuggestionIds,
    currentDocumentHash,
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
    showWarning,
  } = input;

  const pendingPatchApproval = useMemo<PendingPatchApproval | null>(() => {
    if (agentStatus === "submitted" || agentStatus === "streaming") {
      return null;
    }
    if (!latestDraftOutput) {
      return null;
    }
    if (
      !shouldRequestLocalPatchApproval({
        latestDraftOutput,
        latestAppliedSuggestionId:
          latestApplyPatchOutput?.suggestion_id ?? null,
        locallyResolvedSuggestionIds,
        currentDocumentHash,
      })
    ) {
      return null;
    }

    return {
      approvalId: `local-${latestDraftOutput.suggestion.id}`,
      draftOutput: latestDraftOutput,
    };
  }, [
    agentStatus,
    currentDocumentHash,
    latestApplyPatchOutput?.suggestion_id,
    latestDraftOutput,
    locallyResolvedSuggestionIds,
  ]);

  const handleApprovePendingPatch = useCallback(async () => {
    if (
      !pendingPatchApproval ||
      agentStatus === "submitted" ||
      agentStatus === "streaming"
    ) {
      return;
    }

    setAgentUiAlert(null);
    clearAgentError();

    try {
      const suggestionId = pendingPatchApproval.draftOutput.suggestion.id;
      if (appliedSuggestionIdsRef.current.has(suggestionId)) {
        return;
      }
      const currentDocumentHash = dashboardDraftDocumentHash(dashboardRef.current);
      const proposalBaseDocumentHash =
        pendingPatchApproval.draftOutput.base_document_fingerprint?.trim() || null;
      if (!proposalBaseDocumentHash || proposalBaseDocumentHash !== currentDocumentHash) {
        const detail =
          "当前看板已经被保存或调整，之前的确认卡已过期。请重新让智能体基于当前布局生成新的修改。";
        setLocallyResolvedSuggestionIds((current) =>
          new Set(current).add(suggestionId),
        );
        setMessages((prev) =>
          pruneResolvedPatchProposalPayloads(prev, { mode: "matching", suggestionId }),
        );
        showWarning(detail, 6);
        setAgentUiAlert(detail);
        return;
      }
      pendingApprovalEventRef.current = {
        proposalId: suggestionId,
        decision: "approve",
        baseVersion:
          pendingPatchApproval.draftOutput.base_version ?? getBaseVersion(),
        currentDocumentHash,
      };
      await sendMessage({ text: "Apply the approved staged patch." });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Unable to approve the staged patch.";
      const nextError = error instanceof Error ? error : new Error(detail);
      setAgentError(nextError);
      setAgentStatus("error");
      setAgentUiAlert(detail);
    } finally {
      pendingApprovalEventRef.current = null;
    }
  }, [
    agentStatus,
    appliedSuggestionIdsRef,
    clearAgentError,
    dashboardRef,
    getBaseVersion,
    pendingApprovalEventRef,
    pendingPatchApproval,
    sendMessage,
    setAgentError,
    setAgentStatus,
    setAgentUiAlert,
    setLocallyResolvedSuggestionIds,
    setMessages,
    showWarning,
  ]);

  const handleRejectPendingPatch = useCallback(async () => {
    if (
      !pendingPatchApproval ||
      agentStatus === "submitted" ||
      agentStatus === "streaming"
    ) {
      return;
    }

    setAgentUiAlert(null);
    clearAgentError();

    try {
      const suggestionId = pendingPatchApproval.draftOutput.suggestion.id;
      const currentDocumentHash = dashboardDraftDocumentHash(dashboardRef.current);
      const proposalBaseDocumentHash =
        pendingPatchApproval.draftOutput.base_document_fingerprint?.trim() || null;
      if (!proposalBaseDocumentHash || proposalBaseDocumentHash !== currentDocumentHash) {
        setLocallyResolvedSuggestionIds((current) =>
          new Set(current).add(suggestionId),
        );
        setMessages((prev) =>
          pruneResolvedPatchProposalPayloads(prev, { mode: "matching", suggestionId }),
        );
        return;
      }
      pendingApprovalEventRef.current = {
        proposalId: suggestionId,
        decision: "reject",
        baseVersion:
          pendingPatchApproval.draftOutput.base_version ?? getBaseVersion(),
        currentDocumentHash,
      };
      await sendMessage({ text: "Reject the staged patch." });
      setLocallyResolvedSuggestionIds((current) =>
        new Set(current).add(suggestionId),
      );
      setMessages((prev) =>
        pruneResolvedPatchProposalPayloads(prev, { mode: "all_unresolved" }),
      );
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Unable to reject the staged patch.";
      setAgentUiAlert(detail);
    } finally {
      pendingApprovalEventRef.current = null;
    }
  }, [
    agentStatus,
    clearAgentError,
    dashboardRef,
    getBaseVersion,
    pendingApprovalEventRef,
    pendingPatchApproval,
    sendMessage,
    setAgentUiAlert,
    setLocallyResolvedSuggestionIds,
    setMessages,
  ]);

  return {
    pendingPatchApproval,
    handleApprovePendingPatch,
    handleRejectPendingPatch,
  };
}
