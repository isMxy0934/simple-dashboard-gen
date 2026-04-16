import { createUIMessageStreamResponse } from "ai";
import { stripMainAgentMessagesForModel } from "@/ai/main-agent/messages/client-parts";
import { outlineMainAgentMessages } from "@/ai/main-agent/messages/message-outline";
import { createDashboardWorkerStream } from "@/ai/dashboard-worker";
import { createViewWorkerStream } from "@/ai/view-worker";
import { registerMainAgentActiveStream } from "@/server/main-agent/active-streams";
import { buildMainAgentModelInput } from "@/server/main-agent/model-input";
import {
  initializeMainAgentChatSession,
  persistMainAgentChatSessionSnapshot,
} from "@/server/main-agent/chat-session-orchestrator";
import {
  listMainAgentSkills,
  loadMainAgentSkill,
  loadMainAgentSkillReference,
} from "@/server/ai/skill-loader";
import { resolveAgentChatRequest } from "@/server/main-agent/chat-request";
import { listMainAgentChecks } from "@/server/main-agent/checks-repository";
import {
  listAgentDatasources,
  loadAgentDatasourceSchema,
} from "@/server/datasource/context-service";
import { executePreview } from "@/server/execution/execute-batch";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";
import { resolveMainAgentWorkerRoute } from "@/ai/main-agent/routing";

export const maxDuration = 30;

export async function handleAgentChatRoute(request: Request): Promise<Response> {
  const resolvedRequest = await resolveAgentChatRequest(request);
  if (!resolvedRequest.ok) {
    return resolvedRequest.response;
  }

  const {
    sessionId,
    dashboardId,
    focusedViewId,
    turnId,
    dashboard,
    messages,
  } = resolvedRequest.input;
  const checks = dashboardId ? await listMainAgentChecks(dashboardId).catch(() => []) : [];
  const datasources = await listAgentDatasources().catch(() => []);
  const skills = await listMainAgentSkills().catch(() => []);
  const rawModelMessages = stripMainAgentMessagesForModel(messages);
  const currentSession = await initializeMainAgentChatSession({
    sessionId,
    dashboardId,
    dashboard,
    datasources,
    messages,
  });
  const modelInput = buildMainAgentModelInput({
    dashboard,
    dashboardId,
    focusedViewId,
    datasources,
    checks,
    messages: rawModelMessages,
    lastContextFingerprint: currentSession.prompt.lastContextFingerprint,
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
      focused_view_id: focusedViewId,
      client_message_count: messages.length,
      model_message_count: modelInput.messages.length,
      client_messages_outline: outlineMainAgentMessages(messages),
      model_messages_outline: outlineMainAgentMessages(modelInput.messages),
      context_injected: modelInput.injectedContext,
    },
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

  const workerRoute = resolveMainAgentWorkerRoute({
    dashboard,
    messages: rawModelMessages,
    focusedViewId,
  });
  const runWorker =
    workerRoute.worker === "view" ? createViewWorkerStream : createDashboardWorkerStream;

  await trace("main-agent", "route-worker", {
    worker: workerRoute.worker,
    focused_view_id: workerRoute.focusedViewId,
    reason: workerRoute.reason,
  });

  const { stream: engineStream, getDraftSnapshot } = await runWorker({
    dashboard,
    dashboardId,
    focusedViewId: workerRoute.focusedViewId,
    datasources,
    skills,
    messages: rawModelMessages,
    modelMessages: modelInput.messages,
    checks,
    initialWorkingDraft: currentSession.prompt.workingDraft,
    sessionId,
    dependencies: {
      executePreview,
      listDatasources: listAgentDatasources,
      loadDatasourceSchema: loadAgentDatasourceSchema,
      loadSkill: loadMainAgentSkill,
      loadSkillReference: loadMainAgentSkillReference,
      writeTraceEvent: ({ scope, event, payload }) => trace(scope, event, payload),
    },
    abortSignal: request.signal,
    onStepFinish: async ({ messages: nextMessages }) => {
      await trace("agent-chat-flow", "ui_stream_step_finish", {
        message_count: nextMessages.length,
        outline: outlineMainAgentMessages(nextMessages),
      });
      await persistMainAgentChatSessionSnapshot({
        sessionId,
        dashboardId,
        previous: currentSession,
        messages: nextMessages,
        dashboard,
        datasources,
        lastContextFingerprint: modelInput.contextFingerprint,
        workingDraft: getDraftSnapshot(),
      });
    },
    onFinish: async ({ messages: nextMessages }) => {
      await trace("agent-chat-flow", "ui_stream_finish", {
        message_count: nextMessages.length,
        outline: outlineMainAgentMessages(nextMessages),
      });
      await persistMainAgentChatSessionSnapshot({
        sessionId,
        dashboardId,
        previous: currentSession,
        messages: nextMessages,
        dashboard,
        datasources,
        lastContextFingerprint: modelInput.contextFingerprint,
        workingDraft: getDraftSnapshot(),
      });
    },
  });

  const responseStream = registerMainAgentActiveStream({
    sessionId,
    dashboardId,
    turnId,
    stream: engineStream,
  });

  return createUIMessageStreamResponse({
    stream: responseStream,
  });
}
