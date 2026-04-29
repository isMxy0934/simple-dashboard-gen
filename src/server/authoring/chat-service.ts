import { createUIMessageStreamResponse } from "ai";
import { createAuthoringAgentStream } from "@/ai/authoring";
import { finalizeIncompleteToolCalls } from "@/ai/authoring/messages/incomplete-tools";
import { outlineAuthoringMessages } from "@/ai/authoring/messages/outline";
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
  loadAuthoringSkillReference,
} from "@/server/ai/skill-loader";
import {
  listAgentDatasources,
  loadAgentDatasourceSchema,
} from "@/server/datasource/context-service";
import { executePreview } from "@/server/execution/execute-batch";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";

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
    messages,
    intent,
    baseVersion,
    approvalEvent,
  } = resolvedRequest.input;
  const checks = dashboardId
    ? await listAuthoringChecks(
        dashboardId,
        sessionId,
        workspaceId ?? "ws_default",
      ).catch(() => [])
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
    messages,
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
      message_count: messages.length,
      messages_outline: outlineAuthoringMessages(messages),
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
  const getWorkflowStateV2Snapshot = () =>
    agentStreamResult?.getWorkflowStateV2Snapshot() ??
    currentSession.prompt.workflowV2;
  const getContextFingerprintSnapshot = () =>
    agentStreamResult?.contextFingerprint ??
    currentSession.prompt.lastContextFingerprint;
  const getRejectedProposalIdSnapshot = () => {
    const maybeRejectedSnapshotSource = agentStreamResult as
      | (NonNullable<typeof agentStreamResult> & {
          getRejectedProposalIdSnapshot?: () => string | null;
        })
      | null;
    return typeof maybeRejectedSnapshotSource?.getRejectedProposalIdSnapshot ===
      "function"
      ? maybeRejectedSnapshotSource.getRejectedProposalIdSnapshot()
      : null;
  };

  agentStreamResult =
    await createAuthoringAgentStream({
      dashboard,
      dashboardId,
      focusedViewId,
      datasources: datasourcesForRuntime,
      skills,
      messages,
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
      initialWorkflowStateV2: currentSession.prompt.workflowV2,
      sessionId,
      dependencies: {
        executePreview,
        listDatasources: listAgentDatasources,
        loadDatasourceSchema: loadAgentDatasourceSchema,
        loadSkill: loadAuthoringSkill,
        loadSkillReference: loadAuthoringSkillReference,
        writeTraceEvent: ({ scope, event, payload }) => trace(scope, event, payload),
      },
      abortSignal: request.signal,
      onStepFinish: async ({ messages: nextMessages }) => {
        await trace("authoring-chat-flow", "ui_stream_step_finish", {
          message_count: nextMessages.length,
          outline: outlineAuthoringMessages(nextMessages),
        });
        await persistAuthoringChatSessionSnapshot({
          sessionId,
          dashboardId,
          previous: currentSession,
          messages: nextMessages,
          dashboard,
          datasources: datasourcesForRuntime,
          lastContextFingerprint: getContextFingerprintSnapshot(),
          workingDraft: getDraftSnapshot(),
          lastRunCheckState: getLastRunCheckStateSnapshot(),
          workflowV2: getWorkflowStateV2Snapshot(),
          rejectedProposalId: getRejectedProposalIdSnapshot(),
        });
      },
      onFinish: async ({ messages: nextMessages }) => {
        const finalizedMessages = finalizeIncompleteToolCalls(nextMessages);
        await trace("authoring-chat-flow", "ui_stream_finish", {
          message_count: finalizedMessages.length,
          outline: outlineAuthoringMessages(finalizedMessages),
        });
        await persistAuthoringChatSessionSnapshot({
          sessionId,
          dashboardId,
          previous: currentSession,
          messages: finalizedMessages,
          dashboard,
          datasources: datasourcesForRuntime,
          lastContextFingerprint: getContextFingerprintSnapshot(),
          workingDraft: getDraftSnapshot(),
          lastRunCheckState: getLastRunCheckStateSnapshot(),
          workflowV2: getWorkflowStateV2Snapshot(),
          rejectedProposalId: getRejectedProposalIdSnapshot(),
        });
      },
    });

  const responseStream = registerAuthoringActiveStream({
    sessionId,
    dashboardId,
    turnId,
    stream: agentStreamResult.stream,
  });

  return createUIMessageStreamResponse({
    stream: responseStream,
  });
}
