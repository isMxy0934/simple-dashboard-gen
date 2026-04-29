import type { DashboardDocument } from "@/contracts";
import type {
  AuthoringMessage,
  DatasourceListItemSummary,
} from "@/ai/authoring/contracts/tool-io";
import {
  AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
  buildEmptyAuthoringChatSessionState,
  isAuthoringChatSessionPayload,
  sanitizeAuthoringChatSessionPayload,
  sanitizeAuthoringRunCheckStateSnapshot,
  sanitizeAuthoringTaskStateSnapshot,
  sanitizeAuthoringWorkingDraftSnapshot,
  sanitizeWorkflowStateV2Snapshot,
  type AuthoringChatSessionPayload,
  type AuthoringRunCheckStateSnapshot,
  type AuthoringTaskStateSnapshot,
  type AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";
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
  messages: AuthoringMessage[];
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
      messages: input.messages,
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
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
  lastContextFingerprint?: string | null;
  workingDraft?: AuthoringWorkingDraftSnapshot | null;
  lastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
  taskState?: AuthoringTaskStateSnapshot | null;
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
    !hasAcceptedV2Reject && hasRejectedApprovalResponse(input.messages);
  const shouldClearDraftState = hasAcceptedV2Reject || hasLegacyReject;
  const messages = hasAcceptedV2Reject
    ? pruneResolvedPatchProposalPayloads(input.messages, {
        mode: "all_unresolved",
      })
    : input.messages;

  await saveAuthoringChatSession({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    payload: sanitizeAuthoringChatSessionPayload({
      ...latest,
      dashboardId: input.dashboardId ?? null,
      messages,
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
        taskState: shouldClearDraftState
          ? null
          : sanitizeAuthoringTaskStateSnapshot(
              input.taskState ?? latest.prompt.taskState,
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

  if (payload && isAuthoringChatSessionPayload(payload)) {
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
