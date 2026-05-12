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

function promptFingerprint(prompt: AuthoringChatSessionPayload["prompt"]): string {
  return JSON.stringify([
    prompt.lastContextFingerprint ?? null,
    prompt.workingDraft ?? null,
    prompt.lastRunCheckState ?? null,
    prompt.rejectedProposalIds ?? [],
  ]);
}

export async function initializeAuthoringChatSession(input: {
  sessionId: string;
  dashboardId?: string | null;
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
  initialSession?: AuthoringChatSessionPayload;
}): Promise<AuthoringChatSessionPayload> {
  // Always load the stored state so we can compare fingerprints (E1).
  const storedPayload = await getAuthoringChatSession(input.sessionId).catch(() => null);
  const storedSession =
    storedPayload && isAuthoringChatSessionPayload(storedPayload)
      ? sanitizeAuthoringChatSessionPayload(storedPayload)
      : null;

  const currentSession =
    input.initialSession ??
    storedSession ?? {
      version: AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
      ...buildEmptyAuthoringChatSessionState({
        sessionId: input.sessionId,
        dashboardId: input.dashboardId,
      }),
      updatedAt: new Date().toISOString(),
    };

  // Skip the prompt_snapshot write when the session already exists in DB and
  // the prompt is identical to what is stored (avoids write amplification).
  // New sessions always need the write to produce the session_initialized event.
  const promptUnchanged =
    storedSession !== null &&
    promptFingerprint(storedSession.prompt) === promptFingerprint(currentSession.prompt);

  if (!promptUnchanged) {
    await appendAuthoringChatSessionEvents({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      expectedMessageCount: currentSession.messages.length,
      prompt: currentSession.prompt,
    });
  }

  return currentSession;
}

export async function loadAuthoringChatSessionSnapshot(input: {
  sessionId: string;
  dashboardId?: string | null;
}): Promise<AuthoringChatSessionPayload> {
  return loadAuthoringChatSessionInternal(input.sessionId, input.dashboardId);
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
  rejectedProposalIds?: readonly string[] | null;
}): Promise<void> {
  const latest = await loadAuthoringChatSessionInternal(
    input.sessionId,
    input.dashboardId,
    input.previous,
  );
  const hasLastContextFingerprint = Object.prototype.hasOwnProperty.call(
    input,
    "lastContextFingerprint",
  );
  const hasWorkingDraft = Object.prototype.hasOwnProperty.call(input, "workingDraft");
  const hasLastRunCheckState = Object.prototype.hasOwnProperty.call(
    input,
    "lastRunCheckState",
  );
  const hasRejectedProposalIds = Object.prototype.hasOwnProperty.call(
    input,
    "rejectedProposalIds",
  );
  await appendAuthoringChatSessionEvents({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    expectedMessageCount: input.previous.messages.length,
    appendMessages: input.appendedAgentMessages ?? [],
    prompt: {
      lastContextFingerprint:
        hasLastContextFingerprint
          ? input.lastContextFingerprint ?? null
          : latest.prompt.lastContextFingerprint,
      workingDraft: sanitizeAuthoringWorkingDraftSnapshot(
        hasWorkingDraft ? input.workingDraft : latest.prompt.workingDraft,
      ),
      lastRunCheckState: sanitizeAuthoringRunCheckStateSnapshot(
        hasLastRunCheckState
          ? input.lastRunCheckState
          : latest.prompt.lastRunCheckState,
      ),
      rejectedProposalIds: hasRejectedProposalIds
        ? [...new Set((input.rejectedProposalIds ?? []).map((id) => id.trim()).filter(Boolean))]
        : latest.prompt.rejectedProposalIds ?? [],
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
