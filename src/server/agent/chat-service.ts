import { createUIMessageStreamResponse } from "ai";
import { stripDashboardAgentMessagesForModel } from "@/ai/dashboard-agent/messages/client-parts";
import { outlineDashboardAgentMessages } from "@/ai/dashboard-agent/messages/message-outline";
import { createDashboardAgentEngineStream } from "@/ai/dashboard-agent/engine/dashboard-agent-engine";
import { registerDashboardAgentActiveStream } from "@/server/agent/active-streams";
import { buildDashboardAgentModelInput } from "@/server/agent/model-input";
import {
  initializeDashboardAgentChatSession,
  persistDashboardAgentChatSessionSnapshot,
} from "@/server/agent/chat-session-orchestrator";
import {
  listDashboardAgentSkills,
  loadDashboardAgentSkill,
  loadDashboardAgentSkillReference,
} from "@/server/ai/skill-loader";
import { resolveAgentChatRequest } from "@/server/agent/chat-request";
import { listDashboardAgentChecks } from "@/server/agent/checks-repository";
import {
  listAgentDatasources,
  loadAgentDatasourceSchema,
} from "@/server/datasource/context-service";
import { executePreview } from "@/server/execution/execute-batch";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";

export const maxDuration = 30;

export async function handleAgentChatRoute(request: Request): Promise<Response> {
  const resolvedRequest = await resolveAgentChatRequest(request);
  if (!resolvedRequest.ok) {
    return resolvedRequest.response;
  }

  const {
    sessionId,
    dashboardId,
    turnId,
    dashboard,
    messages,
  } = resolvedRequest.input;
  const checks = dashboardId ? await listDashboardAgentChecks(dashboardId).catch(() => []) : [];
  const datasources = await listAgentDatasources().catch(() => []);
  const skills = await listDashboardAgentSkills().catch(() => []);
  const rawModelMessages = stripDashboardAgentMessagesForModel(messages);
  const modelInput = buildDashboardAgentModelInput({
    dashboard,
    dashboardId,
    datasources,
    checks,
    messages: rawModelMessages,
  });

  await writeSessionTraceEvent({
    sessionId,
    dashboardId,
    turnId,
    scope: "agent-chat-flow",
    event: "request_start",
    payload: {
      dashboard_name: dashboard.dashboard_spec.dashboard.name,
      view_count: dashboard.dashboard_spec.views.length,
      client_message_count: messages.length,
      model_message_count: modelInput.length,
      client_messages_outline: outlineDashboardAgentMessages(messages),
      model_messages_outline: outlineDashboardAgentMessages(modelInput),
    },
  });

  const currentSession = await initializeDashboardAgentChatSession({
    sessionId,
    dashboardId,
    dashboard,
    datasources,
    messages,
  });

  const trace = async (scope: string, event: string, payload?: unknown) =>
    writeSessionTraceEvent({
      sessionId,
      dashboardId,
      turnId,
      scope,
      event,
      payload,
    });

  const engineStream = await createDashboardAgentEngineStream({
    dashboard,
    dashboardId,
    datasources,
    skills,
    messages: rawModelMessages,
    modelMessages: modelInput,
    checks,
    sessionId,
    dependencies: {
      executePreview,
      listDatasources: listAgentDatasources,
      loadDatasourceSchema: loadAgentDatasourceSchema,
      loadSkill: loadDashboardAgentSkill,
      loadSkillReference: loadDashboardAgentSkillReference,
      writeTraceEvent: ({ scope, event, payload }) => trace(scope, event, payload),
    },
    abortSignal: request.signal,
    onStepFinish: async ({ messages: nextMessages }) => {
      await trace("agent-chat-flow", "ui_stream_step_finish", {
        message_count: nextMessages.length,
        outline: outlineDashboardAgentMessages(nextMessages),
      });
      await persistDashboardAgentChatSessionSnapshot({
        sessionId,
        dashboardId,
        previous: currentSession,
        messages: nextMessages,
        dashboard,
        datasources,
      });
    },
    onFinish: async ({ messages: nextMessages }) => {
      await trace("agent-chat-flow", "ui_stream_finish", {
        message_count: nextMessages.length,
        outline: outlineDashboardAgentMessages(nextMessages),
      });
      await persistDashboardAgentChatSessionSnapshot({
        sessionId,
        dashboardId,
        previous: currentSession,
        messages: nextMessages,
        dashboard,
        datasources,
      });
    },
  });

  const responseStream = registerDashboardAgentActiveStream({
    sessionId,
    dashboardId,
    turnId,
    stream: engineStream,
  });

  return createUIMessageStreamResponse({
    stream: responseStream,
  });
}
