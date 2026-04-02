import type { DashboardDocument } from "@/contracts";
import type {
  DashboardAgentMessage,
  DatasourceListItemSummary,
} from "@/agent/dashboard-agent/contracts/agent-contract";
import { stripDashboardAgentMessagesForModel } from "@/agent/dashboard-agent/messages/client-parts";
import {
  DASHBOARD_AGENT_SESSION_PAYLOAD_VERSION,
  buildEmptyDashboardAgentSessionState,
  isDashboardAgentSessionPayload,
  sanitizeDashboardAgentSessionPayload,
  type DashboardAgentSessionPayload,
} from "@/agent/dashboard-agent/contracts/session-state";
import {
  buildDashboardAgentRequestTaskEvent,
  buildDashboardAgentTaskSnapshot,
  buildTaskOutcomeEvent,
  resolveTaskDashboard,
} from "@/agent/dashboard-agent/runtime/task-sync";
import { createDashboardAgentWorkflow } from "@/agent/dashboard-agent/workflow";
import { executePreview } from "@/server/runtime/execute-batch";
import {
  getDashboardAgentSession,
  saveDashboardAgentSession,
} from "@/server/agent/session-repository";
import {
  appendDashboardAgentTaskEvent,
  syncDashboardAgentTaskSnapshot,
} from "@/server/agent/task-repository";
import { listDashboardAgentChecks } from "@/server/agent/checks-repository";

export async function initializeDashboardAgentChatSession(input: {
  sessionId: string;
  dashboardId?: string | null;
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
  messages: DashboardAgentMessage[];
}): Promise<DashboardAgentSessionPayload> {
  const currentSession = await loadDashboardAgentSession(
    input.sessionId,
    input.dashboardId,
  );
  const checks = input.dashboardId
    ? await listDashboardAgentChecks(input.dashboardId).catch(() => [])
    : [];
  const messagesForWorkflow = stripDashboardAgentMessagesForModel(input.messages);
  const initialWorkflow = createDashboardAgentWorkflow({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    messages: messagesForWorkflow,
    checks,
    dependencies: {
      executePreview,
    },
  });

  await saveDashboardAgentSession({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    payload: sanitizeDashboardAgentSessionPayload({
      ...currentSession,
      dashboardId: input.dashboardId ?? null,
      messages: input.messages,
      updatedAt: new Date().toISOString(),
    }),
  });
  await syncDashboardAgentTaskSnapshot({
    sessionId: input.sessionId,
    snapshot: buildDashboardAgentTaskSnapshot({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
      dashboard: input.dashboard,
      workflow: initialWorkflow,
      messages: messagesForWorkflow,
    }),
    dashboardName: input.dashboard.dashboard_spec.dashboard.name,
  });
  await appendDashboardAgentTaskEvent({
    sessionId: input.sessionId,
    event: buildDashboardAgentRequestTaskEvent({
      workflow: initialWorkflow,
    }),
  });

  return currentSession;
}

export async function persistDashboardAgentChatSessionSnapshot(input: {
  sessionId: string;
  dashboardId?: string | null;
  previous: DashboardAgentSessionPayload;
  messages: DashboardAgentMessage[];
  dashboard: DashboardDocument;
  datasources?: DatasourceListItemSummary[] | null;
}): Promise<void> {
  const latest = await loadDashboardAgentSession(
    input.sessionId,
    input.dashboardId,
    input.previous,
  );

  await saveDashboardAgentSession({
    sessionId: input.sessionId,
    dashboardId: input.dashboardId,
    payload: sanitizeDashboardAgentSessionPayload({
      ...latest,
      dashboardId: input.dashboardId ?? null,
      messages: input.messages,
      updatedAt: new Date().toISOString(),
    }),
  });

  const checks = input.dashboardId
    ? await listDashboardAgentChecks(input.dashboardId).catch(() => [])
    : [];
  const messagesForWorkflow = stripDashboardAgentMessagesForModel(input.messages);
  const dashboardForTask = resolveTaskDashboard({
    dashboard: input.dashboard,
    messages: messagesForWorkflow,
  });
  const workflow = createDashboardAgentWorkflow({
    dashboard: dashboardForTask,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    messages: messagesForWorkflow,
    checks,
    dependencies: {
      executePreview,
    },
  });
  await syncDashboardAgentTaskSnapshot({
    sessionId: input.sessionId,
    snapshot: buildDashboardAgentTaskSnapshot({
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
    await appendDashboardAgentTaskEvent({
      sessionId: input.sessionId,
      event: outcomeEvent,
    });
  }
}

async function loadDashboardAgentSession(
  sessionId: string,
  dashboardId?: string | null,
  fallback?: DashboardAgentSessionPayload,
) {
  const payload = await getDashboardAgentSession(sessionId).catch(() => null);

  if (payload && isDashboardAgentSessionPayload(payload)) {
    return sanitizeDashboardAgentSessionPayload(payload);
  }

  return (
    fallback ?? {
      version: DASHBOARD_AGENT_SESSION_PAYLOAD_VERSION,
      ...buildEmptyDashboardAgentSessionState({
        sessionId,
        dashboardId,
      }),
      updatedAt: new Date().toISOString(),
    }
  );
}
