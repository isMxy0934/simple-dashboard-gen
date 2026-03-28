import type { DashboardDocument, DatasourceContext } from "../../contracts";
import type { AuthoringAgentMessage } from "../../ai/runtime/agent-contract";
import { stripAuthoringAgentMessagesForModel } from "../../ai/runtime/authoring-agent-client-parts";
import {
  AUTHORING_AGENT_SESSION_PAYLOAD_VERSION,
  buildEmptyAgentSessionState,
  isPersistedAuthoringAgentSessionPayload,
  sanitizePersistedAuthoringAgentSessionPayload,
  type PersistedAuthoringAgentSessionPayload,
} from "../../ai/runtime/agent-session-state";
import {
  buildAgentRequestTaskEvent,
  buildAuthoringTaskSnapshot,
  buildTaskOutcomeEvent,
  resolveTaskDashboard,
} from "../../ai/runtime/authoring-task-sync";
import { createDashboardAuthoringWorkflow } from "../../ai/workflow/dashboard-authoring-workflow";
import { executePreview } from "../runtime/execute-batch";
import { writeDebugLog } from "../logging/debug-log";
import { getAuthoringAgentSession, saveAuthoringAgentSession } from "./session-repository";
import {
  appendAuthoringAgentTaskEvent,
  syncAuthoringAgentTaskSnapshot,
} from "./task-repository";

export async function initializeAuthoringAgentChatSession(input: {
  sessionKey: string;
  dashboard: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
  messages: AuthoringAgentMessage[];
}): Promise<PersistedAuthoringAgentSessionPayload> {
  const currentSession = await loadAuthoringAgentSession(input.sessionKey);
  await writeDebugLog("agent-chat-flow", "session-initialize", {
    sessionKey: input.sessionKey,
    incoming_message_count: input.messages.length,
  });
  const messagesForWorkflow = stripAuthoringAgentMessagesForModel(input.messages);
  const initialWorkflow = createDashboardAuthoringWorkflow({
    dashboard: input.dashboard,
    datasourceContext: input.datasourceContext,
    messages: messagesForWorkflow,
    dependencies: {
      executePreview,
      writeDebugLog,
    },
  });

  await saveAuthoringAgentSession({
    sessionKey: input.sessionKey,
    payload: sanitizePersistedAuthoringAgentSessionPayload({
      ...currentSession,
      messages: input.messages,
      updatedAt: new Date().toISOString(),
    }),
  });
  await syncAuthoringAgentTaskSnapshot({
    sessionKey: input.sessionKey,
    snapshot: buildAuthoringTaskSnapshot({
      sessionKey: input.sessionKey,
      dashboard: input.dashboard,
      workflow: initialWorkflow,
      messages: messagesForWorkflow,
    }),
    dashboardName: input.dashboard.dashboard_spec.dashboard.name,
  });
  await appendAuthoringAgentTaskEvent({
    sessionKey: input.sessionKey,
    event: buildAgentRequestTaskEvent({
      workflow: initialWorkflow,
    }),
  });

  return currentSession;
}

export async function persistAuthoringAgentChatSessionSnapshot(input: {
  sessionKey: string;
  previous: PersistedAuthoringAgentSessionPayload;
  messages: AuthoringAgentMessage[];
  dashboard: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
}): Promise<void> {
  const latest = await loadAuthoringAgentSession(input.sessionKey, input.previous);

  await saveAuthoringAgentSession({
    sessionKey: input.sessionKey,
    payload: sanitizePersistedAuthoringAgentSessionPayload({
      ...latest,
      messages: input.messages,
      updatedAt: new Date().toISOString(),
    }),
  });

  const messagesForWorkflow = stripAuthoringAgentMessagesForModel(input.messages);
  const dashboardForTask = resolveTaskDashboard({
    dashboard: input.dashboard,
    messages: messagesForWorkflow,
  });
  const workflow = createDashboardAuthoringWorkflow({
    dashboard: dashboardForTask,
    datasourceContext: input.datasourceContext,
    messages: messagesForWorkflow,
    dependencies: {
      executePreview,
      writeDebugLog,
    },
  });
  await syncAuthoringAgentTaskSnapshot({
    sessionKey: input.sessionKey,
    snapshot: buildAuthoringTaskSnapshot({
      sessionKey: input.sessionKey,
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
    await appendAuthoringAgentTaskEvent({
      sessionKey: input.sessionKey,
      event: outcomeEvent,
    });
  }
}

async function loadAuthoringAgentSession(
  sessionKey: string,
  fallback?: PersistedAuthoringAgentSessionPayload,
) {
  const payload = await getAuthoringAgentSession(sessionKey).catch(() => null);

  if (payload && isPersistedAuthoringAgentSessionPayload(payload)) {
    return sanitizePersistedAuthoringAgentSessionPayload(payload);
  }

  return (
    fallback ?? {
      version: AUTHORING_AGENT_SESSION_PAYLOAD_VERSION,
      ...buildEmptyAgentSessionState(),
      updatedAt: new Date().toISOString(),
    }
  );
}
