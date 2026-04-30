import type { DashboardDocument } from "@/contracts";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { DatasourceListItemSummary } from "@/ai/authoring/contracts/tool-io";
import {
  AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
  type AuthoringChatSessionPayload,
  type AuthoringRunCheckStateSnapshot,
  type AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";
import {
  buildEmptyAuthoringChatSessionState,
  isAuthoringChatSessionPayload,
  sanitizeAuthoringChatSessionPayload,
  sanitizeAuthoringRunCheckStateSnapshot,
  sanitizeAuthoringWorkingDraftSnapshot,
  sanitizeAuthoringWorkflowStateSnapshot,
} from "@/ai/authoring/runtime/session-sanitize";
import type { AuthoringWorkflowState } from "@/ai/authoring/workflow/types";
import {
  getAuthoringChatSession,
  saveAuthoringChatSession,
} from "@/server/authoring/session-repository";

export async function initializeAuthoringChatSession(input: {
  sessionId: string;
  dashboardId?: string | null;
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
  agentMessages?: AgentMessage[];
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
      updatedAt: new Date().toISOString(),
    }),
  });

  return currentSession;
}

export async function persistAuthoringChatSessionSnapshot(input: {
  sessionId: string;
  dashboardId?: string | null;
  previous: AuthoringChatSessionPayload;
  agentMessages?: AgentMessage[];
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
  lastContextFingerprint?: string | null;
  workingDraft?: AuthoringWorkingDraftSnapshot | null;
  lastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
  workflow?: AuthoringWorkflowState | null;
}): Promise<void> {
  const latest = await loadAuthoringChatSessionInternal(
    input.sessionId,
    input.dashboardId,
    input.previous,
  );
  await saveAuthoringChatSession({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    payload: sanitizeAuthoringChatSessionPayload({
      ...latest,
      dashboardId: input.dashboardId ?? null,
      messages: input.agentMessages ?? latest.messages,
      updatedAt: new Date().toISOString(),
      prompt: {
        lastContextFingerprint:
          input.lastContextFingerprint ?? latest.prompt.lastContextFingerprint,
        workingDraft: sanitizeAuthoringWorkingDraftSnapshot(
          input.workingDraft ?? latest.prompt.workingDraft,
        ),
        lastRunCheckState: sanitizeAuthoringRunCheckStateSnapshot(
          input.lastRunCheckState ?? latest.prompt.lastRunCheckState,
        ),
        workflow: sanitizeAuthoringWorkflowStateSnapshot(
          input.workflow ?? latest.prompt.workflow,
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
