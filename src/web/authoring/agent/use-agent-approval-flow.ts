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
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";

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
  const pendingPatchApproval = useMemo<PendingPatchApproval | null>(() => {
    if (input.agentStatus === "submitted" || input.agentStatus === "streaming") {
      return null;
    }
    if (!input.latestDraftOutput) {
      return null;
    }
    if (
      !shouldRequestLocalPatchApproval({
        latestDraftOutput: input.latestDraftOutput,
        latestAppliedSuggestionId:
          input.latestApplyPatchOutput?.suggestion_id ?? null,
        locallyResolvedSuggestionIds: input.locallyResolvedSuggestionIds,
        currentDocumentHash: input.currentDocumentHash,
      })
    ) {
      return null;
    }

    return {
      approvalId: `local-${input.latestDraftOutput.suggestion.id}`,
      draftOutput: input.latestDraftOutput,
    };
  }, [
    input.agentStatus,
    input.currentDocumentHash,
    input.latestApplyPatchOutput?.suggestion_id,
    input.latestDraftOutput,
    input.locallyResolvedSuggestionIds,
  ]);

  const handleApprovePendingPatch = useCallback(async () => {
    if (
      !pendingPatchApproval ||
      input.agentStatus === "submitted" ||
      input.agentStatus === "streaming"
    ) {
      return;
    }

    input.setAgentUiAlert(null);
    input.clearAgentError();

    try {
      const suggestionId = pendingPatchApproval.draftOutput.suggestion.id;
      if (input.appliedSuggestionIdsRef.current.has(suggestionId)) {
        return;
      }
      const currentDocumentHash = dashboardDocumentPersistenceFingerprint(
        input.dashboardRef.current,
      );
      const proposalBaseDocumentHash =
        pendingPatchApproval.draftOutput.base_document_fingerprint?.trim() || null;
      if (!proposalBaseDocumentHash || proposalBaseDocumentHash !== currentDocumentHash) {
        const detail =
          "当前看板已经被保存或调整，之前的确认卡已过期。请重新让智能体基于当前布局生成新的修改。";
        input.setLocallyResolvedSuggestionIds((current) =>
          new Set(current).add(suggestionId),
        );
        input.setMessages((prev) =>
          pruneResolvedPatchProposalPayloads(prev, { mode: "matching", suggestionId }),
        );
        input.showWarning(detail, 6);
        input.setAgentUiAlert(detail);
        return;
      }
      input.pendingApprovalEventRef.current = {
        proposalId: suggestionId,
        decision: "approve",
        baseVersion:
          pendingPatchApproval.draftOutput.base_version ?? input.getBaseVersion(),
        currentDocumentHash,
      };
      await input.sendMessage({ text: "Apply the approved staged patch." });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Unable to approve the staged patch.";
      const nextError = error instanceof Error ? error : new Error(detail);
      input.setAgentError(nextError);
      input.setAgentStatus("error");
      input.setAgentUiAlert(detail);
    } finally {
      input.pendingApprovalEventRef.current = null;
    }
  }, [input, pendingPatchApproval]);

  const handleRejectPendingPatch = useCallback(async () => {
    if (
      !pendingPatchApproval ||
      input.agentStatus === "submitted" ||
      input.agentStatus === "streaming"
    ) {
      return;
    }

    input.setAgentUiAlert(null);
    input.clearAgentError();

    try {
      const suggestionId = pendingPatchApproval.draftOutput.suggestion.id;
      const currentDocumentHash = dashboardDocumentPersistenceFingerprint(
        input.dashboardRef.current,
      );
      const proposalBaseDocumentHash =
        pendingPatchApproval.draftOutput.base_document_fingerprint?.trim() || null;
      if (!proposalBaseDocumentHash || proposalBaseDocumentHash !== currentDocumentHash) {
        input.setLocallyResolvedSuggestionIds((current) =>
          new Set(current).add(suggestionId),
        );
        input.setMessages((prev) =>
          pruneResolvedPatchProposalPayloads(prev, { mode: "matching", suggestionId }),
        );
        return;
      }
      input.pendingApprovalEventRef.current = {
        proposalId: suggestionId,
        decision: "reject",
        baseVersion:
          pendingPatchApproval.draftOutput.base_version ?? input.getBaseVersion(),
        currentDocumentHash,
      };
      await input.sendMessage({ text: "Reject the staged patch." });
      input.setLocallyResolvedSuggestionIds((current) =>
        new Set(current).add(suggestionId),
      );
      input.setMessages((prev) =>
        pruneResolvedPatchProposalPayloads(prev, { mode: "all_unresolved" }),
      );
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Unable to reject the staged patch.";
      input.setAgentUiAlert(detail);
    } finally {
      input.pendingApprovalEventRef.current = null;
    }
  }, [input, pendingPatchApproval]);

  return {
    pendingPatchApproval,
    handleApprovePendingPatch,
    handleRejectPendingPatch,
  };
}
