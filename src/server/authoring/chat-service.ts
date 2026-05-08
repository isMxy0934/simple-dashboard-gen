import { createAuthoringAgentStream } from "@/ai/authoring";
import {
  listAuthoringChecks,
  saveAuthoringChecks,
} from "@/server/authoring/checks-repository";
import {
  hasAuthoringActiveStream,
  registerAuthoringActiveStream,
} from "@/server/authoring/active-streams";
import {
  initializeAuthoringChatSession,
  loadAuthoringChatSessionSnapshot,
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
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ViewCheckSnapshot } from "@/ai/authoring/contracts/tool-io";
import { findLatestApplyPatchOutputFromTranscript } from "@/ai/authoring/runtime/transcript-inspection";
import {
  openEditingSession,
  saveAppliedEditingSession,
} from "@/server/cloud/editing-session-repository";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import { validateAuthoringApprovalPreflight } from "@/server/authoring/approval-preflight";

export const maxDuration = 180;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRunCheckSnapshots(messages: AgentMessage[]): ViewCheckSnapshot[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role !== "toolResult" ||
      message.toolName !== "runCheck" ||
      !isRecord(message.details) ||
      !Array.isArray(message.details.checks)
    ) {
      continue;
    }
    return message.details.checks.filter((check): check is ViewCheckSnapshot =>
      isRecord(check) && typeof check.view_id === "string",
    );
  }

  return [];
}

export async function handleAuthoringChatRoute(request: Request): Promise<Response> {
  const resolvedRequest = await resolveAgentChatRequest(request);
  if (!resolvedRequest.ok) {
    return resolvedRequest.response;
  }

  const {
    workspaceId,
    userId,
    editingSessionId,
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
  if (await hasAuthoringActiveStream(sessionId)) {
    return Response.json(
      {
        status_code: 409,
        reason: "AUTHORING_STREAM_ACTIVE",
        data: null,
      },
      { status: 409 },
    );
  }

  const checks = dashboardId
    ? await listAuthoringChecks(
        dashboardId,
        sessionId,
        workspaceId,
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
  const currentSessionSnapshot = await loadAuthoringChatSessionSnapshot({
    sessionId,
    dashboardId,
  });
  const approvalPreflightError = validateAuthoringApprovalPreflight({
    approvalEvent,
    currentSession: currentSessionSnapshot,
    dashboard,
  });
  if (approvalPreflightError) {
    return approvalPreflightError;
  }

  const currentSession = await initializeAuthoringChatSession({
    sessionId,
    dashboardId,
    dashboard,
    datasources: datasourcesForRuntime,
    initialSession: currentSessionSnapshot,
  });
  const previousApplyOutput = findLatestApplyPatchOutputFromTranscript(
    currentSession.messages,
  );

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
      currentDocumentHash: dashboardDocumentPersistenceFingerprint(dashboard),
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
        const runCheckSnapshots = extractRunCheckSnapshots(agentMessages);
        if (dashboardId && runCheckSnapshots.length > 0) {
          await saveAuthoringChecks({
            workspaceId,
            dashboardId,
            sessionId,
            checks: runCheckSnapshots,
          }).catch((error) => {
            console.error("[chat-service] saveAuthoringChecks failed:", error);
          });
        }
        const applyOutput = findLatestApplyPatchOutputFromTranscript(agentMessages);
        if (
          applyOutput?.dashboard &&
          applyOutput.suggestion_id !== previousApplyOutput?.suggestion_id
        ) {
          const editingSession = await openEditingSession({
            workspaceId,
            userId,
            dashboardId,
            sessionId: editingSessionId,
          });
          await saveAppliedEditingSession({
            workspaceId,
            userId,
            dashboardId,
            sessionId: editingSessionId,
            baseVersion: baseVersion ?? editingSession.sessionPayload.baseVersion,
            canonicalDraft: applyOutput.dashboard,
            focusViewId: applyOutput.focused_view_id ?? focusedViewId,
            previousPayload: editingSession.sessionPayload,
            lastSuggestionId: applyOutput.suggestion_id,
            expectedSessionRevision: editingSession.sessionRevision,
            expectedDocumentHash: dashboardDocumentPersistenceFingerprint(
              editingSession.sessionPayload.canonicalDraft,
            ),
          });
        }
        await persistAuthoringChatSessionSnapshot({
          sessionId,
          dashboardId,
          previous: currentSession,
          appendedAgentMessages: agentMessages.slice(currentSession.messages.length),
          dashboard,
          datasources: datasourcesForRuntime,
          lastContextFingerprint: getContextFingerprintSnapshot(),
          workingDraft: getDraftSnapshot(),
          lastRunCheckState: getLastRunCheckStateSnapshot(),
        });
      },
    });

  const responseStream = await registerAuthoringActiveStream({
    sessionId,
    dashboardId,
    turnId,
    stream: agentStreamResult.stream,
  });
  if (!responseStream) {
    return Response.json(
      {
        status_code: 409,
        reason: "AUTHORING_STREAM_ACTIVE",
        data: null,
      },
      { status: 409 },
    );
  }

  return new Response(responseStream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
