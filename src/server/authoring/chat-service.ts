import { createAuthoringAgentStream } from "@/ai/authoring";
import { listAuthoringChecks } from "@/server/authoring/checks-repository";
import { registerAuthoringActiveStream } from "@/server/authoring/active-streams";
import {
  initializeAuthoringChatSession,
  persistAuthoringChatSessionSnapshot,
} from "@/server/authoring/chat-session-orchestrator";
import { resolveAgentChatRequest } from "@/server/authoring/chat-request";
import {
  listAuthoringSkills,
  loadAuthoringSkill,
} from "@/server/ai/skill-loader";
import {
  listAgentDatasources,
  loadAgentDatasourceSchema,
} from "@/server/datasource/context-service";
import { executePreview } from "@/server/execution/execute-batch";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";
import { writeAuthoringAgentLedgerEvent } from "@/server/logs/authoring-agent-ledger-writer";
import { DEFAULT_WORKSPACE_ID } from "@/shared/workspace-defaults";

export const maxDuration = 180;

export async function handleAuthoringChatRoute(request: Request): Promise<Response> {
  const resolvedRequest = await resolveAgentChatRequest(request);
  if (!resolvedRequest.ok) {
    return resolvedRequest.response;
  }

  const {
    workspaceId,
    sessionId,
    dashboardId,
    focusedViewId,
    turnId,
    dashboard,
    messageText,
    intent,
    baseVersion,
    approvalEvent,
  } = resolvedRequest.input;
  const checks = dashboardId
    ? await listAuthoringChecks(
        dashboardId,
        sessionId,
        workspaceId ?? DEFAULT_WORKSPACE_ID,
      ).catch((error) => {
        console.error("[chat-service] listAuthoringChecks failed:", error);
        throw error;
      })
    : [];
  let datasources: Awaited<ReturnType<typeof listAgentDatasources>> = [];
  let datasourcesLoadFailed = false;
  try {
    datasources = await listAgentDatasources();
  } catch (err) {
    datasourcesLoadFailed = true;
    console.error("[chat-service] listAgentDatasources failed:", err);
  }
  const datasourcesForRuntime = datasourcesLoadFailed ? null : datasources;

  let skills: Awaited<ReturnType<typeof listAuthoringSkills>> = [];
  let skillsLoadFailed = false;
  try {
    skills = await listAuthoringSkills();
  } catch (err) {
    skillsLoadFailed = true;
    console.error("[chat-service] listAuthoringSkills failed:", err);
  }
  const currentSession = await initializeAuthoringChatSession({
    sessionId,
    dashboardId,
    dashboard,
    datasources: datasourcesForRuntime,
  });

  await writeSessionTraceEvent({
    sessionId,
    dashboardId,
    turnId,
    scope: "authoring-chat-flow",
    event: "request_start",
    payload: {
      dashboard_name: dashboard.dashboard_spec.dashboard.name,
      view_count: dashboard.dashboard_spec.views.length,
      focused_view_id: focusedViewId,
      message_count: currentSession.messages.length,
      latest_user_text: messageText,
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

  let agentStreamResult: Awaited<
    ReturnType<typeof createAuthoringAgentStream>
  > | null = null;
  const getDraftSnapshot = () =>
    agentStreamResult?.getDraftSnapshot() ?? currentSession.prompt.workingDraft;
  const getLastRunCheckStateSnapshot = () =>
    agentStreamResult?.getLastRunCheckStateSnapshot() ??
    currentSession.prompt.lastRunCheckState;
  const getContextFingerprintSnapshot = () =>
    agentStreamResult?.contextFingerprint ??
    currentSession.prompt.lastContextFingerprint;

  agentStreamResult =
    await createAuthoringAgentStream({
      dashboard,
      dashboardId,
      focusedViewId,
      datasources: datasourcesForRuntime,
      skills,
      agentMessages: currentSession.messages,
      promptText: messageText,
      checks,
      intent,
      approvalEvent,
      baseVersion: baseVersion ?? undefined,
      loadFailures: {
        datasources: datasourcesLoadFailed,
        skills: skillsLoadFailed,
      },
      initialWorkingDraft: currentSession.prompt.workingDraft,
      initialLastRunCheckState: currentSession.prompt.lastRunCheckState,
      sessionId,
      turnId,
      dependencies: {
        executePreview,
        listDatasources: listAgentDatasources,
        loadDatasourceSchema: loadAgentDatasourceSchema,
        loadSkill: loadAuthoringSkill,
        writeTraceEvent: ({ scope, event, payload }) => trace(scope, event, payload),
        writeLedgerEvent: writeAuthoringAgentLedgerEvent,
      },
      abortSignal: request.signal,
      onFinish: async ({ agentMessages }) => {
        await trace("authoring-chat-flow", "ui_stream_finish", {
          message_count: agentMessages.length,
        });
        await persistAuthoringChatSessionSnapshot({
          sessionId,
          dashboardId,
          previous: currentSession,
          agentMessages,
          dashboard,
          datasources: datasourcesForRuntime,
          lastContextFingerprint: getContextFingerprintSnapshot(),
          workingDraft: getDraftSnapshot(),
          lastRunCheckState: getLastRunCheckStateSnapshot(),
        });
      },
    });

  const responseStream = registerAuthoringActiveStream({
    sessionId,
    dashboardId,
    turnId,
    stream: agentStreamResult.stream,
  });

  return new Response(responseStream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
