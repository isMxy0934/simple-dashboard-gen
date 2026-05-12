import type { DashboardDocument } from "@/contracts";
import type {
  AuthoringApprovalEvent,
  AuthoringDraftOutput,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringChatSessionPayload } from "@/ai/authoring/contracts/session";
import {
  findDraftOutputBySuggestionIdFromTranscript,
  findLatestApplyPatchOutputFromTranscript,
  findLatestDraftOutputFromTranscript,
} from "@/ai/authoring/runtime/transcript-inspection";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

function approvalConflictResponse(
  reason: string,
  data: Record<string, unknown>,
): Response {
  return Response.json(
    {
      status_code: 409,
      reason,
      data,
    },
    { status: 409 },
  );
}

function resolvePendingApprovalDraft(
  messages: AgentMessage[],
  proposalId: string,
): AuthoringDraftOutput | null {
  const requestedDraft = findDraftOutputBySuggestionIdFromTranscript(messages, proposalId);
  if (requestedDraft) {
    return requestedDraft;
  }
  return findLatestDraftOutputFromTranscript(messages);
}

export function validateAuthoringApprovalPreflight(input: {
  approvalEvent: AuthoringApprovalEvent | null;
  currentSession: AuthoringChatSessionPayload;
  dashboard: DashboardDocument;
}): Response | null {
  const approvalEvent = input.approvalEvent;
  if (!approvalEvent) {
    return null;
  }

  const proposalId = approvalEvent.proposalId.trim();
  const approvedDocumentHash = approvalEvent.currentDocumentHash.trim();
  const currentDocumentHash = dashboardDocumentPersistenceFingerprint(input.dashboard);
  if (approvedDocumentHash !== currentDocumentHash) {
    return approvalConflictResponse("APPROVAL_CURRENT_DOCUMENT_HASH_MISMATCH", {
      proposalId,
      approvedDocumentHash,
      currentDocumentHash,
    });
  }

  const rejectedProposalIds = input.currentSession.prompt.rejectedProposalIds ?? [];
  if (rejectedProposalIds.includes(proposalId)) {
    return approvalConflictResponse("APPROVAL_PROPOSAL_REJECTED", {
      proposalId,
    });
  }

  const latestApply = findLatestApplyPatchOutputFromTranscript(
    input.currentSession.messages,
  );
  if (latestApply?.suggestion_id === proposalId) {
    return approvalConflictResponse("APPROVAL_ALREADY_APPLIED", {
      proposalId,
    });
  }

  const pendingDraft = resolvePendingApprovalDraft(
    input.currentSession.messages,
    proposalId,
  );
  if (!pendingDraft) {
    return approvalConflictResponse("APPROVAL_PROPOSAL_NOT_FOUND", {
      proposalId,
    });
  }

  const pendingProposalId = pendingDraft.suggestion.id;
  if (pendingProposalId !== proposalId) {
    return approvalConflictResponse("APPROVAL_PROPOSAL_MISMATCH", {
      proposalId,
      pendingProposalId,
    });
  }

  if (
    typeof pendingDraft.base_version !== "number" ||
    pendingDraft.base_version !== approvalEvent.baseVersion
  ) {
    return approvalConflictResponse("APPROVAL_BASE_VERSION_MISMATCH", {
      proposalId,
      approvedBaseVersion: approvalEvent.baseVersion,
      pendingBaseVersion: pendingDraft.base_version ?? null,
    });
  }

  if (!pendingDraft.draft_fingerprint?.trim()) {
    return approvalConflictResponse("APPROVAL_DRAFT_FINGERPRINT_MISSING", {
      proposalId,
    });
  }

  if (
    !pendingDraft.base_document_fingerprint?.trim() ||
    pendingDraft.base_document_fingerprint !== currentDocumentHash
  ) {
    return approvalConflictResponse("APPROVAL_DOCUMENT_HASH_MISMATCH", {
      proposalId,
      pendingBaseDocumentHash: pendingDraft.base_document_fingerprint ?? null,
      currentDocumentHash,
    });
  }

  return null;
}
