import type { DashboardDocument } from "@/contracts";
import type {
  MainAgentMessage,
  DatasourceListItemSummary,
} from "@/ai/main-agent/contracts/agent-contract";
import { stripMainAgentMessagesForModel } from "@/ai/main-agent/messages/client-parts";
import {
  MAIN_AGENT_CHAT_SESSION_PAYLOAD_VERSION,
  buildEmptyMainAgentChatSessionState,
  isMainAgentChatSessionPayload,
  sanitizeMainAgentWorkingDraftSnapshot,
  sanitizeMainAgentChatSessionPayload,
  type MainAgentChatSessionPayload,
  type MainAgentWorkingDraftSnapshot,
} from "@/ai/main-agent/contracts/session-state";
import {
  buildMainAgentRequestTaskEvent,
  buildMainAgentTaskSnapshot,
  buildTaskOutcomeEvent,
  resolveTaskDashboard,
} from "@/ai/main-agent/engine/task-sync";
import { createWorkerWorkflow } from "@/ai/dashboard-worker/workflow";
import { hasRejectedApprovalResponse } from "@/ai/main-agent/messages/message-inspection";
import { executePreview } from "@/server/execution/execute-batch";
import {
  listMainAgentSkills,
  loadMainAgentSkill,
  loadMainAgentSkillReference,
} from "@/server/ai/skill-loader";
import {
  getMainAgentChatSession,
  saveMainAgentChatSession,
} from "@/server/main-agent/session-repository";
import {
  appendMainAgentTaskEvent,
  syncMainAgentTaskSnapshot,
} from "@/server/main-agent/task-repository";
import { listMainAgentChecks } from "@/server/main-agent/checks-repository";

export async function initializeMainAgentChatSession(input: {
  sessionId: string;
  dashboardId?: string | null;
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
  messages: MainAgentMessage[];
}): Promise<MainAgentChatSessionPayload> {
  const currentSession = await loadMainAgentChatSessionInternal(
    input.sessionId,
    input.dashboardId,
  );
  const checks = input.dashboardId
    ? await listMainAgentChecks(input.dashboardId, input.sessionId).catch(() => [])
    : [];
  const skills = await listMainAgentSkills().catch(() => []);
  const messagesForWorkflow = stripMainAgentMessagesForModel(input.messages);
  const initialWorkflow = createWorkerWorkflow({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    skills,
    messages: messagesForWorkflow,
    checks,
    initialWorkingDraft: currentSession.prompt.workingDraft,
    dependencies: {
      executePreview,
      loadSkill: loadMainAgentSkill,
      loadSkillReference: loadMainAgentSkillReference,
    },
  });

  await saveMainAgentChatSession({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    payload: sanitizeMainAgentChatSessionPayload({
      ...currentSession,
      dashboardId: input.dashboardId ?? null,
      messages: input.messages,
      updatedAt: new Date().toISOString(),
    }),
  });
  await syncMainAgentTaskSnapshot({
    sessionId: input.sessionId,
    snapshot: buildMainAgentTaskSnapshot({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      dashboard: input.dashboard,
      workflow: initialWorkflow,
      messages: messagesForWorkflow,
    }),
    dashboardName: input.dashboard.dashboard_spec.dashboard.name,
  });
  await appendMainAgentTaskEvent({
    sessionId: input.sessionId,
    event: buildMainAgentRequestTaskEvent({
      workflow: initialWorkflow,
    }),
  });

  return currentSession;
}

export async function persistMainAgentChatSessionSnapshot(input: {
  sessionId: string;
  dashboardId?: string | null;
  previous: MainAgentChatSessionPayload;
  messages: MainAgentMessage[];
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
  lastContextFingerprint?: string | null;
  workingDraft?: MainAgentWorkingDraftSnapshot | null;
}): Promise<void> {
  const latest = await loadMainAgentChatSessionInternal(
    input.sessionId,
    input.dashboardId,
    input.previous,
  );

  await saveMainAgentChatSession({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    payload: sanitizeMainAgentChatSessionPayload({
      ...latest,
      dashboardId: input.dashboardId ?? null,
      messages: input.messages,
      updatedAt: new Date().toISOString(),
      prompt: {
        lastContextFingerprint:
          input.lastContextFingerprint ?? latest.prompt.lastContextFingerprint,
        workingDraft: hasRejectedApprovalResponse(input.messages)
          ? null
          : sanitizeMainAgentWorkingDraftSnapshot(
              input.workingDraft ?? latest.prompt.workingDraft,
            ),
      },
    }),
  });

  const checks = input.dashboardId
    ? await listMainAgentChecks(input.dashboardId, input.sessionId).catch(() => [])
    : [];
  const skills = await listMainAgentSkills().catch(() => []);
  const messagesForWorkflow = stripMainAgentMessagesForModel(input.messages);
  const dashboardForTask = resolveTaskDashboard({
    dashboard: input.dashboard,
    messages: messagesForWorkflow,
  });
  const workflow = createWorkerWorkflow({
    dashboard: dashboardForTask,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    skills,
    messages: messagesForWorkflow,
    checks,
    initialWorkingDraft:
      input.workingDraft ?? latest.prompt.workingDraft,
    dependencies: {
      executePreview,
      loadSkill: loadMainAgentSkill,
      loadSkillReference: loadMainAgentSkillReference,
    },
  });
  await syncMainAgentTaskSnapshot({
    sessionId: input.sessionId,
    snapshot: buildMainAgentTaskSnapshot({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      dashboard: dashboardForTask,
      workflow,
      messages: input.messages,
    }),
    dashboardName: dashboardForTask.dashboard_spec.dashboard.name,
  });

  const outcomeEvent = buildTaskOutcomeEvent({
    messages: input.messages,
  });

  if (outcomeEvent) {
    await appendMainAgentTaskEvent({
      sessionId: input.sessionId,
      event: outcomeEvent,
    });
  }
}

async function loadMainAgentChatSessionInternal(
  sessionId: string,
  dashboardId?: string | null,
  fallback?: MainAgentChatSessionPayload,
) {
  const payload = await getMainAgentChatSession(sessionId).catch(() => null);

  if (payload && isMainAgentChatSessionPayload(payload)) {
    return sanitizeMainAgentChatSessionPayload(payload);
  }

  return (
    fallback ?? {
      version: MAIN_AGENT_CHAT_SESSION_PAYLOAD_VERSION,
      ...buildEmptyMainAgentChatSessionState({
        sessionId,
        dashboardId,
      }),
      updatedAt: new Date().toISOString(),
    }
  );
}
