import type { DashboardDocument } from "@/contracts";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  AuthoringMessage,
  DatasourceListItemSummary,
} from "@/ai/authoring/contracts/tool-io";
import {
  AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
  type AuthoringChatSessionPayload,
  type AuthoringRunCheckStateSnapshot,
  type AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";
import {
  buildEmptyAuthoringChatSessionState,
  sanitizeAuthoringChatSessionPayload,
  sanitizeAuthoringRunCheckStateSnapshot,
  sanitizeAuthoringWorkingDraftSnapshot,
  sanitizeWorkflowStateV2Snapshot,
} from "@/ai/authoring/runtime/session-sanitize";
import type { WorkflowStateV2 } from "@/ai/authoring/v2/types";
import {
  getAuthoringChatSession,
  saveAuthoringChatSession,
} from "@/server/authoring/session-repository";
import { hasRejectedApprovalResponse } from "@/ai/authoring/messages/inspection";
import { pruneResolvedPatchProposalPayloads } from "@/ai/authoring/messages/message-prune";

export async function initializeAuthoringChatSession(input: {
  sessionId: string;
  dashboardId?: string | null;
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
  agentMessages?: AgentMessage[];
  uiMessages?: AuthoringMessage[];
}): Promise<AuthoringChatSessionPayload> {
  const currentSession = await loadAuthoringChatSessionInternal(
    input.sessionId,
    input.dashboardId,
  );

  await saveAuthoringChatSession({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    payload: sanitizeAuthoringChatSessionPayload({
      ...currentSession,
      dashboardId: input.dashboardId ?? null,
      messages: input.agentMessages ?? currentSession.messages,
      uiMessages:
        input.uiMessages && input.uiMessages.length > 0
          ? input.uiMessages
          : currentSession.uiMessages,
      updatedAt: new Date().toISOString(),
    }),
  });

  return currentSession;
}

export async function persistAuthoringChatSessionSnapshot(input: {
  sessionId: string;
  dashboardId?: string | null;
  previous: AuthoringChatSessionPayload;
  messages: AuthoringMessage[];
  agentMessages?: AgentMessage[];
  uiMessages?: AuthoringMessage[];
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
  lastContextFingerprint?: string | null;
  workingDraft?: AuthoringWorkingDraftSnapshot | null;
  lastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
  workflowV2?: WorkflowStateV2 | null;
  rejectedProposalId?: string | null;
}): Promise<void> {
  const latest = await loadAuthoringChatSessionInternal(
    input.sessionId,
    input.dashboardId,
    input.previous,
  );
  const hasAcceptedV2Reject = Boolean(input.rejectedProposalId);
  const hasLegacyReject =
    !hasAcceptedV2Reject && hasRejectedApprovalResponse(input.uiMessages ?? input.messages);
  const shouldClearDraftState = hasAcceptedV2Reject || hasLegacyReject;
  const uiMessages = hasAcceptedV2Reject
    ? pruneResolvedPatchProposalPayloads(input.uiMessages ?? input.messages, {
        mode: "all_unresolved",
      })
    : input.uiMessages ?? input.messages;

  await saveAuthoringChatSession({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    payload: sanitizeAuthoringChatSessionPayload({
      ...latest,
      dashboardId: input.dashboardId ?? null,
      messages: input.agentMessages ?? latest.messages,
      uiMessages,
      updatedAt: new Date().toISOString(),
      prompt: {
        lastContextFingerprint:
          input.lastContextFingerprint ?? latest.prompt.lastContextFingerprint,
        workingDraft: shouldClearDraftState
          ? null
          : sanitizeAuthoringWorkingDraftSnapshot(
              input.workingDraft ?? latest.prompt.workingDraft,
            ),
        lastRunCheckState: shouldClearDraftState
          ? null
          : sanitizeAuthoringRunCheckStateSnapshot(
              input.lastRunCheckState ?? latest.prompt.lastRunCheckState,
            ),
        workflowV2: hasLegacyReject
          ? null
          : sanitizeWorkflowStateV2Snapshot(
              input.workflowV2 ?? latest.prompt.workflowV2,
            ),
      },
    }),
  });
}

async function loadAuthoringChatSessionInternal(
  sessionId: string,
  dashboardId?: string | null,
  fallback?: AuthoringChatSessionPayload,
) {
  const payload = await getAuthoringChatSession(sessionId).catch(() => null);

  if (payload) {
    return sanitizeAuthoringChatSessionPayload(payload);
  }

  return (
    fallback ?? {
      version: AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
      ...buildEmptyAuthoringChatSessionState({
        sessionId,
        dashboardId,
      }),
      updatedAt: new Date().toISOString(),
    }
  );
}
