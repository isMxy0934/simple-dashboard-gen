import { createUIMessageStreamResponse } from "ai";
import { stripAuthoringAgentMessagesForModel } from "../../ai/runtime/authoring-agent-client-parts";
import { outlineAuthoringAgentMessages } from "../../ai/runtime/authoring-message-outline";
import { createDashboardAgentRuntimeStream } from "../../ai/runtime/dashboard-agent-runtime";
import { registerAuthoringAgentActiveStream } from "./active-streams";
import { initializeAuthoringAgentChatSession, persistAuthoringAgentChatSessionSnapshot } from "./chat-session-orchestrator";
import { resolveAgentChatRequest } from "./chat-request";
import { executePreview } from "../runtime/execute-batch";
import { writeDebugLog } from "../logging/debug-log";

export const maxDuration = 30;

export async function handleAgentChatRoute(request: Request): Promise<Response> {
  const resolvedRequest = await resolveAgentChatRequest(request);
  if (!resolvedRequest.ok) {
    return resolvedRequest.response;
  }

  const { sessionKey, dashboard, datasourceContext, messages } = resolvedRequest.input;
  const messagesForModel = stripAuthoringAgentMessagesForModel(messages);

  await writeDebugLog("agent-chat-flow", "request-start", {
    sessionKey,
    dashboard_name: dashboard.dashboard_spec.dashboard.name,
    view_count: dashboard.dashboard_spec.views.length,
    client_message_count: messages.length,
    model_message_count: messagesForModel.length,
    client_messages_outline: outlineAuthoringAgentMessages(messages),
    model_messages_outline: outlineAuthoringAgentMessages(messagesForModel),
  });

  const currentSession = await initializeAuthoringAgentChatSession({
    sessionKey,
    dashboard,
    datasourceContext,
    messages,
  });

  const runtimeStream = await createDashboardAgentRuntimeStream({
    dashboard,
    datasourceContext,
    messages: messagesForModel,
    sessionKey,
    dependencies: {
      executePreview,
      writeDebugLog,
    },
    abortSignal: request.signal,
    onStepFinish: async ({ messages: nextMessages }) => {
      await writeDebugLog("agent-chat-flow", "ui-stream-step-finish", {
        sessionKey,
        message_count: nextMessages.length,
        outline: outlineAuthoringAgentMessages(nextMessages),
      });
      await persistAuthoringAgentChatSessionSnapshot({
        sessionKey,
        previous: currentSession,
        messages: nextMessages,
        dashboard,
        datasourceContext,
      });
    },
    onFinish: async ({ messages: nextMessages }) => {
      await writeDebugLog("agent-chat-flow", "ui-stream-finish", {
        sessionKey,
        message_count: nextMessages.length,
        outline: outlineAuthoringAgentMessages(nextMessages),
      });
      await persistAuthoringAgentChatSessionSnapshot({
        sessionKey,
        previous: currentSession,
        messages: nextMessages,
        dashboard,
        datasourceContext,
      });
    },
  });

  const responseStream = registerAuthoringAgentActiveStream({
    sessionKey,
    stream: runtimeStream,
  });

  return createUIMessageStreamResponse({
    stream: responseStream,
  });
}
