import {
  AuthoringAgentSession,
  type AuthoringAgentSessionConfig,
} from "@/ai/authoring/agent/session";
import {
  listAuthoringChecks,
} from "@/server/authoring/checks-repository";
import {
  hasAuthoringActiveStream,
  registerAuthoringActiveStream,
  releaseAuthoringStreamSlot,
  reserveAuthoringStreamSlot,
} from "@/server/authoring/active-streams";
import {
  getAuthoringAgentPoolEntry,
  hasAuthoringAgentPoolEntry,
  registerAuthoringAgentPoolEntry,
} from "@/server/authoring/agent-pool";
import {
  initializeAuthoringChatSession,
  loadAuthoringChatSessionSnapshot,
} from "@/server/authoring/chat-session-orchestrator";
import { resolveAgentChatRequest } from "@/server/authoring/chat-request";
import {
  filterAuthoringSkillsForTemplate,
  listAuthoringSkills,
  loadAuthoringSkill,
} from "@/server/ai/skill-loader";
import {
  listAgentDatasources,
  loadAgentDatasourceSchema,
} from "@/server/datasource/context-service";
import { executePreview } from "@/server/execution/execute-batch";
import { emitAuthoringTraceEvent } from "@/server/logs/authoring-trace";
import { writeAuthoringAgentLedgerEvent } from "@/server/logs/authoring-agent-ledger-writer";
import type {
  AuthoringApprovalEvent,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringChatSessionPayload } from "@/ai/authoring/contracts/session";
import type { DashboardDocument } from "@/contracts";
import { findLatestApplyPatchOutputFromTranscript } from "@/ai/authoring/runtime/transcript-inspection";
import { canonicalDashboardDocumentFingerprint } from "@/domain/dashboard/document-fingerprint";
import { validateAuthoringApprovalPreflight } from "@/server/authoring/approval-preflight";
import { buildAuthoringOnFinishHandler } from "@/server/authoring/on-finish-handler";
import { assertDashboardDocumentQuota } from "@/server/guards/quotas";


async function readResponseReason(response: Response): Promise<string | null> {
  try {
    const payload = await response.clone().json();
    return typeof payload?.reason === "string" ? payload.reason : null;
  } catch {
    return null;
  }
}

function waitForApprovalSnapshotRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function filterAuthoritativeChecks(
  checks: ViewCheckSnapshot[],
  documentHash: string,
): ViewCheckSnapshot[] {
  return checks.filter(
    (check) =>
      check.document_hash === documentHash &&
      (check.source === "server" || check.source === undefined),
  );
}

async function validateApprovalPreflightWithSessionReload(input: {
  approvalEvent: AuthoringApprovalEvent | null;
  sessionId: string;
  dashboardId: string;
  dashboard: DashboardDocument;
  initialSession: AuthoringChatSessionPayload;
  signal?: AbortSignal;
}) {
  let currentSession = input.initialSession;
  let preflightError = validateAuthoringApprovalPreflight({
    approvalEvent: input.approvalEvent,
    currentSession,
    dashboard: input.dashboard,
  });

  if (!input.approvalEvent || !preflightError) {
    return { currentSession, preflightError };
  }

  let reason = await readResponseReason(preflightError);
  if (reason !== "APPROVAL_PROPOSAL_NOT_FOUND") {
    return { currentSession, preflightError };
  }

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    await waitForApprovalSnapshotRetry(250, input.signal);
    currentSession = await loadAuthoringChatSessionSnapshot({
      sessionId: input.sessionId,
      dashboardId: input.dashboardId,
    });
    preflightError = validateAuthoringApprovalPreflight({
      approvalEvent: input.approvalEvent,
      currentSession,
      dashboard: input.dashboard,
    });
    if (!preflightError) {
      return { currentSession, preflightError: null };
    }
    reason = await readResponseReason(preflightError);
    if (reason !== "APPROVAL_PROPOSAL_NOT_FOUND") {
      return { currentSession, preflightError };
    }
  }

  return { currentSession, preflightError };
}

export async function handleAuthoringChatRoute(request: Request): Promise<Response> {
  const resolvedRequest = await resolveAgentChatRequest(request);
  if (!resolvedRequest.ok) {
    return resolvedRequest.response;
  }

  const {
    workspaceId,
    userId,
    permissions,
    editingSessionId,
    sessionId,
    dashboardId,
    requestId,
    focusedViewId,
    turnId,
    dashboard,
    messageText,
    intent,
    baseVersion,
    approvalEvent,
    modelRuntime,
  } = resolvedRequest.input;

  if (await hasAuthoringActiveStream(sessionId)) {
    return Response.json(
      { status_code: 409, reason: "AUTHORING_STREAM_ACTIVE", data: null },
      { status: 409 },
    );
  }

  const currentDocumentHash = canonicalDashboardDocumentFingerprint(dashboard);
  const checks = dashboardId
    ? await listAuthoringChecks(dashboardId, sessionId, workspaceId).catch((error) => {
        console.error("[chat-service] listAuthoringChecks failed:", error);
        throw error;
      })
    : [];
  const authoritativeChecks = filterAuthoritativeChecks(checks, currentDocumentHash);

  let datasources: Awaited<ReturnType<typeof listAgentDatasources>> = [];
  let datasourcesLoadFailed = false;
  try {
    datasources = await listAgentDatasources(workspaceId);
  } catch (err) {
    datasourcesLoadFailed = true;
    console.error("[chat-service] listAgentDatasources failed:", err);
  }
  const datasourcesForRuntime = datasourcesLoadFailed ? null : datasources;

  let skills: Awaited<ReturnType<typeof listAuthoringSkills>> = [];
  let skillsLoadFailed = false;
  try {
    skills = filterAuthoringSkillsForTemplate(
      await listAuthoringSkills({
        templateId: dashboard.dashboard_spec.template?.id ?? null,
        designKitId: dashboard.dashboard_spec.presentation.design_kit_id,
      }),
      dashboard.dashboard_spec.template?.id?.trim() ||
        dashboard.dashboard_spec.presentation.design_kit_id,
    );
  } catch (err) {
    skillsLoadFailed = true;
    console.error("[chat-service] listAuthoringSkills failed:", err);
  }

  // Acquire the stream lease BEFORE loading session state and starting the
  // agent turn. Concurrent requests for the same session will fail here rather
  // than after the agent has already consumed LLM tokens.
  const streamSlotOwnerId = await reserveAuthoringStreamSlot({
    sessionId,
    dashboardId,
    turnId,
    requestId,
  });
  if (!streamSlotOwnerId) {
    return Response.json(
      { status_code: 409, reason: "AUTHORING_STREAM_ACTIVE", data: null },
      { status: 409 },
    );
  }

  let streamRegistered = false;
  try {
    let currentSessionSnapshot = await loadAuthoringChatSessionSnapshot({
      sessionId,
      dashboardId,
    });
    const approvalPreflight = await validateApprovalPreflightWithSessionReload({
      approvalEvent,
      sessionId,
      dashboardId,
      dashboard,
      initialSession: currentSessionSnapshot,
      signal: request.signal,
    });
    currentSessionSnapshot = approvalPreflight.currentSession;
    if (approvalPreflight.preflightError) {
      return approvalPreflight.preflightError;
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
    const rejectedProposalIds = new Set(currentSession.prompt.rejectedProposalIds ?? []);
    if (approvalEvent?.decision === "reject") {
      const proposalId = approvalEvent.proposalId.trim();
      if (proposalId) {
        rejectedProposalIds.add(proposalId);
      }
    }
    const rejectedProposalIdsForTurn = [...rejectedProposalIds];

    // Snapshot getters are late-bound: they point at agentStreamResult which is
    // available only after startTurn(). The onFinish callback is invoked after
    // the stream finishes, so by that time the getters have been updated.
    const snapshotGetters = {
      getDraftSnapshot: () => currentSession.prompt.workingDraft,
      getLastRunCheckStateSnapshot: () => currentSession.prompt.lastRunCheckState,
      getContextFingerprintSnapshot: () => currentSession.prompt.lastContextFingerprint ?? "",
    };

    await emitAuthoringTraceEvent({
      sessionId,
      dashboardId,
      turnId,
      requestId,
      scope: "authoring-chat-flow",
      event: "request_start",
      payload: {
        dashboard_name: dashboard.dashboard_spec.dashboard.name,
        view_count: dashboard.dashboard_spec.views.length,
        focused_view_id: focusedViewId,
        message_count: currentSession.messages.length,
        latest_user_text: messageText,
        pool_hit: hasAuthoringAgentPoolEntry(sessionId),
      },
    });

    const trace = async (scope: string, event: string, payload?: unknown) =>
      emitAuthoringTraceEvent({
        sessionId,
        dashboardId,
        turnId,
        requestId,
        scope,
        event,
        payload,
      });

    const dependencies: AuthoringAgentSessionConfig["dependencies"] = {
      executePreview,
      listDatasources: () => listAgentDatasources(workspaceId),
      loadDatasourceSchema: (datasourceId: string) =>
        loadAgentDatasourceSchema(datasourceId, workspaceId),
      loadSkill: loadAuthoringSkill,
      assertDashboardQuota: (document) =>
        assertDashboardDocumentQuota(document, {
          sessionId,
          dashboardId,
          turnId,
          requestId,
          scopeId: dashboardId,
        }),
      writeTraceEvent: ({ scope, event, payload }) => trace(scope, event, payload),
      writeLedgerEvent: writeAuthoringAgentLedgerEvent,
    };

    // ------------------------------------------------------------------
    // Pool integration: reuse or create the AuthoringAgentSession.
    // ------------------------------------------------------------------
    const poolEntry = getAuthoringAgentPoolEntry(sessionId);
    let agentSession: AuthoringAgentSession;

    /** Number of messages already in the Agent before this turn. Used to compute
     *  the delta for `persistAuthoringChatSessionSnapshot`. */
    let messageCountBeforeTurn: number;

    const onFinish = buildAuthoringOnFinishHandler({
      workspaceId,
      userId,
      sessionId,
      dashboardId,
      editingSessionId,
      turnId,
      requestId,
      focusedViewId,
      baseVersion,
      dashboard,
      currentSession,
      // Resolved after the pool branch below; the getter is invoked only when
      // the stream finishes, by which time messageCountBeforeTurn is assigned.
      getMessageCountBeforeTurn: () => messageCountBeforeTurn,
      datasourcesForRuntime,
      previousApplySuggestionId: previousApplyOutput?.suggestion_id,
      approvalEvent,
      rejectedProposalIds: rejectedProposalIdsForTurn,
      getDraftSnapshot: () => snapshotGetters.getDraftSnapshot(),
      getLastRunCheckStateSnapshot: () => snapshotGetters.getLastRunCheckStateSnapshot(),
      getContextFingerprintSnapshot: () => snapshotGetters.getContextFingerprintSnapshot(),
    });

    if (poolEntry) {
      // Warm path: update the existing session with this turn's configuration.
      agentSession = poolEntry.session;
      messageCountBeforeTurn =
        agentSession.piAgent?.state.messages.length ?? currentSession.messages.length;
      agentSession.setTurnConfig({
        dashboard,
        dashboardId,
        focusedViewId,
        datasources: datasourcesForRuntime,
        skills,
        checks: authoritativeChecks,
        promptText: messageText,
        intent,
        approvalEvent,
        rejectedProposalIds: rejectedProposalIdsForTurn,
        currentDocumentHash,
        baseVersion: baseVersion ?? undefined,
        modelRuntime,
        permissions,
        dependencies,
        loadFailures: { datasources: datasourcesLoadFailed, skills: skillsLoadFailed },
        turnId,
        abortSignal: request.signal,
        onFinish,
      });
    } else {
      // Cold path: create a new session and register it in the pool.
      messageCountBeforeTurn = currentSession.messages.length;
      agentSession = new AuthoringAgentSession({
        dashboard,
        dashboardId,
        focusedViewId,
        datasources: datasourcesForRuntime,
        skills,
        agentMessages: currentSession.messages,
        promptText: messageText,
        checks: authoritativeChecks,
        intent,
        approvalEvent,
        rejectedProposalIds: rejectedProposalIdsForTurn,
        currentDocumentHash,
        baseVersion: baseVersion ?? undefined,
        modelRuntime,
        permissions,
        loadFailures: { datasources: datasourcesLoadFailed, skills: skillsLoadFailed },
        initialWorkingDraft: currentSession.prompt.workingDraft,
        initialLastRunCheckState: currentSession.prompt.lastRunCheckState,
        sessionId,
        turnId,
        dependencies,
        abortSignal: request.signal,
        onFinish,
      });
      registerAuthoringAgentPoolEntry(sessionId, agentSession);
    }

    const agentStreamResult = await agentSession.startTurn();

    // Wire up the real snapshot getters now that agentStreamResult is available.
    snapshotGetters.getDraftSnapshot = () =>
      agentStreamResult.getDraftSnapshot();
    snapshotGetters.getLastRunCheckStateSnapshot = () =>
      agentStreamResult.getLastRunCheckStateSnapshot();
    snapshotGetters.getContextFingerprintSnapshot = () =>
      agentStreamResult.contextFingerprint ?? currentSession.prompt.lastContextFingerprint ?? "";

    const responseStream = await registerAuthoringActiveStream({
      sessionId,
      dashboardId,
      turnId,
      stream: agentStreamResult.stream,
      ownerId: streamSlotOwnerId,
      requestId,
    });
    if (!responseStream) {
      return Response.json(
        { status_code: 409, reason: "AUTHORING_STREAM_ACTIVE", data: null },
        { status: 409 },
      );
    }

    streamRegistered = true;
    return new Response(responseStream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } finally {
    if (!streamRegistered) {
      await releaseAuthoringStreamSlot({
        sessionId,
        dashboardId,
        turnId,
        ownerId: streamSlotOwnerId,
        requestId,
      });
    }
  }
}
