import "server-only";

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { DashboardDocument } from "@/contracts";
import type {
  ApplyPatchToolInput,
  ApplyPatchToolOutput,
  AuthoringApprovalEvent,
} from "@/ai/authoring/contracts/tool-io";
import { buildAuthoringTools } from "@/ai/authoring/tools/factory";
import {
  findDraftOutputBySuggestionIdFromTranscript,
  findLatestApplyPatchOutputFromTranscript,
  findLatestDraftOutputFromTranscript,
} from "@/ai/authoring/runtime/transcript-inspection";
import { formatAuthoringToolResultContent } from "@/ai/authoring/runtime/tool-result-content";
import {
  initializeAuthoringChatSession,
  persistAuthoringChatSessionSnapshot,
} from "@/server/authoring/chat-session-orchestrator";
import {
  listAuthoringSkills,
  loadAuthoringSkill,
} from "@/server/ai/skill-loader";
import {
  listAgentDatasources,
  loadAgentDatasourceSchema,
} from "@/server/datasource/context-service";
import { executePreview } from "@/server/execution/execute-batch";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";
import { writeAuthoringAgentLedgerEvent } from "@/server/logs/authoring-agent-ledger-writer";
import { createTurnId } from "@/server/logs/session-ids";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import {
  openEditingSession,
  saveAppliedEditingSession,
} from "@/server/cloud/editing-session-repository";
import { serviceError, serviceOk, type ServiceResult } from "@/server/service-result";

export interface ApplyApprovedAuthoringPatchInput {
  workspaceId: string;
  userId: string;
  sessionId: string;
  chatSessionId: string;
  dashboardId: string;
  focusedViewId: string | null;
  dashboard: DashboardDocument;
  proposalId: string;
  baseVersion: number;
  currentDocumentHash: string;
}

export interface ApplyApprovedAuthoringPatchResult {
  output: ApplyPatchToolOutput;
}

function buildApprovalContext(
  messages: AgentMessage[],
  approvalEvent: AuthoringApprovalEvent,
) {
  const latestDraft = findLatestDraftOutputFromTranscript(messages);
  const pendingProposalId = latestDraft?.suggestion.id ?? null;
  const pendingProposalBaseVersion =
    typeof latestDraft?.base_version === "number" ? latestDraft.base_version : null;
  const proposalId =
    approvalEvent.decision === "approve" ? approvalEvent.proposalId : null;
  const baseVersion =
    approvalEvent.decision === "approve" ? approvalEvent.baseVersion : null;

  return {
    approved: Boolean(
      proposalId &&
        pendingProposalId &&
        proposalId === pendingProposalId &&
        typeof baseVersion === "number" &&
        typeof pendingProposalBaseVersion === "number" &&
        baseVersion === pendingProposalBaseVersion &&
        latestDraft?.draft_fingerprint &&
        latestDraft.base_document_fingerprint,
    ),
    proposalId,
    baseVersion,
    pendingProposalId,
    pendingProposalBaseVersion,
    draftFingerprint: latestDraft?.draft_fingerprint ?? null,
    baseDocumentFingerprint: latestDraft?.base_document_fingerprint ?? null,
  };
}

function buildSyntheticApplyPatchMessages(input: {
  output: ApplyPatchToolOutput;
  proposalId: string;
}): AgentMessage[] {
  const timestamp = Date.now();
  const toolCallId = `direct_apply_${input.proposalId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${timestamp}`;
  const { dashboard: _dashboard, ...persistedOutput } = input.output;
  return [
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: toolCallId,
          name: "applyPatch",
          arguments: {
            suggestion_id: input.proposalId,
          },
        },
      ],
      stopReason: "toolUse",
      timestamp,
    } as unknown as AgentMessage,
    {
      role: "toolResult",
      toolCallId,
      toolName: "applyPatch",
      content: formatAuthoringToolResultContent("applyPatch", persistedOutput),
      details: persistedOutput,
      isError: false,
      timestamp: timestamp + 1,
    } as AgentMessage,
  ];
}

export async function applyApprovedAuthoringPatch(
  input: ApplyApprovedAuthoringPatchInput,
): Promise<ServiceResult<ApplyApprovedAuthoringPatchResult>> {
  const turnId = createTurnId();
  const currentSession = await initializeAuthoringChatSession({
    sessionId: input.chatSessionId,
    dashboardId: input.dashboardId,
    dashboard: input.dashboard,
  });
  const latestApply = findLatestApplyPatchOutputFromTranscript(currentSession.messages);
  if (latestApply?.suggestion_id === input.proposalId) {
    return serviceError({
      code: "AUTHORING_APPROVAL_ALREADY_RESOLVED",
      status: 409,
      reason: "The approved proposal has already been resolved.",
      details: {
        proposalId: input.proposalId,
      },
    });
  }

  const approvalEvent: AuthoringApprovalEvent = {
    proposalId: input.proposalId,
    decision: "approve",
    baseVersion: input.baseVersion,
  };
  const approvalContext = buildApprovalContext(
    currentSession.messages,
    approvalEvent,
  );

  await writeSessionTraceEvent({
    sessionId: input.chatSessionId,
    dashboardId: input.dashboardId,
    turnId,
    scope: "authoring-approval",
    event: "direct_apply_requested",
    payload: {
      proposal_id: input.proposalId,
      base_version: input.baseVersion,
      approved: approvalContext.approved,
    },
  });

  if (!approvalContext.approved) {
    return serviceError({
      code: "AUTHORING_APPROVAL_CONFLICT",
      status: 409,
      reason: "Approved proposal does not match the pending proposal.",
      details: {
        proposalId: input.proposalId,
        pendingProposalId: approvalContext.pendingProposalId,
        baseVersion: input.baseVersion,
        pendingProposalBaseVersion: approvalContext.pendingProposalBaseVersion,
      },
    });
  }

  const requestDocumentHash = dashboardDocumentPersistenceFingerprint(input.dashboard);
  if (requestDocumentHash !== input.currentDocumentHash) {
    return serviceError({
      code: "AUTHORING_APPROVAL_HASH_CONFLICT",
      status: 409,
      reason: "Current dashboard document hash does not match the request document.",
      details: {
        currentDocumentHash: input.currentDocumentHash,
        requestDocumentHash,
      },
    });
  }

  if (
    approvalContext.baseDocumentFingerprint &&
    approvalContext.baseDocumentFingerprint !== input.currentDocumentHash
  ) {
    return serviceError({
      code: "AUTHORING_APPROVAL_BASE_DOCUMENT_CONFLICT",
      status: 409,
      reason: "Dashboard changed after this proposal was composed. Compose a fresh proposal before applying.",
      details: {
        proposalId: input.proposalId,
        expectedDocumentHash: approvalContext.baseDocumentFingerprint,
        currentDocumentHash: input.currentDocumentHash,
      },
    });
  }

  const skills = await listAuthoringSkills().catch(() => []);
  const toolRuntime = buildAuthoringTools({
    scope: input.focusedViewId
      ? { kind: "focused", viewId: input.focusedViewId }
      : { kind: "dashboard" },
    activeTools: ["applyPatch"],
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    skills,
    initialWorkingDraft: currentSession.prompt.workingDraft,
    initialLastRunCheckState: currentSession.prompt.lastRunCheckState,
    findLatestDraftOutput: () =>
      findLatestDraftOutputFromTranscript(currentSession.messages),
    findDraftOutputBySuggestionId: (suggestionId) =>
      findDraftOutputBySuggestionIdFromTranscript(
        currentSession.messages,
        suggestionId,
      ),
    getRuntimeApprovalContext: () => approvalContext,
    getBaseVersion: () => input.baseVersion,
    dependencies: {
      executePreview,
      listDatasources: listAgentDatasources,
      loadDatasourceSchema: loadAgentDatasourceSchema,
      loadSkill: loadAuthoringSkill,
      writeTraceEvent: ({ scope, event, payload }) =>
        writeSessionTraceEvent({
          sessionId: input.chatSessionId,
          dashboardId: input.dashboardId,
          turnId,
          scope,
          event,
          payload,
        }),
      writeLedgerEvent: writeAuthoringAgentLedgerEvent,
    },
  });

  const applyPatchTool = toolRuntime.tools.applyPatch as {
    execute: (
      params: ApplyPatchToolInput,
    ) => Promise<ApplyPatchToolOutput> | ApplyPatchToolOutput;
  };
  const output = await applyPatchTool.execute({
    suggestion_id: input.proposalId,
  });
  const syntheticMessages = buildSyntheticApplyPatchMessages({
    output,
    proposalId: input.proposalId,
  });

  await persistAuthoringChatSessionSnapshot({
    sessionId: input.chatSessionId,
    dashboardId: input.dashboardId,
    previous: currentSession,
    agentMessages: [...currentSession.messages, ...syntheticMessages],
    dashboard: output.dashboard ?? input.dashboard,
    lastContextFingerprint: currentSession.prompt.lastContextFingerprint,
    workingDraft: toolRuntime.getDraftSnapshot(),
    lastRunCheckState: toolRuntime.getLastRunCheckStateSnapshot(),
  });

  const editingSession = await openEditingSession({
    workspaceId: input.workspaceId,
    userId: input.userId,
    dashboardId: input.dashboardId,
    sessionId: input.sessionId,
  });
  await saveAppliedEditingSession({
    workspaceId: input.workspaceId,
    userId: input.userId,
    dashboardId: input.dashboardId,
    sessionId: input.sessionId,
    baseVersion: input.baseVersion,
    canonicalDraft: output.dashboard ?? input.dashboard,
    focusViewId: output.focused_view_id ?? input.focusedViewId,
    previousPayload: editingSession.sessionPayload,
    lastSuggestionId: output.suggestion_id,
  });

  await writeSessionTraceEvent({
    sessionId: input.chatSessionId,
    dashboardId: input.dashboardId,
    turnId,
    scope: "authoring-approval",
    event: "direct_apply_finished",
    payload: {
      proposal_id: output.suggestion_id,
      applied: output.applied,
      has_dashboard: Boolean(output.dashboard),
    },
  });

  return serviceOk({ output });
}
