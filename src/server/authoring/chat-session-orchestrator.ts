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
} from "@/ai/authoring/runtime/session-sanitize";
import {
  appendAuthoringChatSessionEvents,
  getAuthoringChatSession,
} from "@/server/authoring/session-repository";

export async function initializeAuthoringChatSession(input: {
  sessionId: string;
  dashboardId?: string | null;
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
}): Promise<AuthoringChatSessionPayload> {
  const currentSession = await loadAuthoringChatSessionInternal(
    input.sessionId,
    input.dashboardId,
  );

  await appendAuthoringChatSessionEvents({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    expectedMessageCount: currentSession.messages.length,
    prompt: currentSession.prompt,
  });

  return currentSession;
}

export async function persistAuthoringChatSessionSnapshot(input: {
  sessionId: string;
  dashboardId?: string | null;
  previous: AuthoringChatSessionPayload;
  appendedAgentMessages?: AgentMessage[];
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
  lastContextFingerprint?: string | null;
  workingDraft?: AuthoringWorkingDraftSnapshot | null;
  lastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
}): Promise<void> {
  const latest = await loadAuthoringChatSessionInternal(
    input.sessionId,
    input.dashboardId,
    input.previous,
  );
  await appendAuthoringChatSessionEvents({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    expectedMessageCount: input.previous.messages.length,
    appendMessages: input.appendedAgentMessages ?? [],
    prompt: {
      lastContextFingerprint:
        input.lastContextFingerprint ?? latest.prompt.lastContextFingerprint,
      workingDraft: sanitizeAuthoringWorkingDraftSnapshot(
        input.workingDraft ?? latest.prompt.workingDraft,
      ),
      lastRunCheckState: sanitizeAuthoringRunCheckStateSnapshot(
        input.lastRunCheckState ?? latest.prompt.lastRunCheckState,
      ),
    },
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
