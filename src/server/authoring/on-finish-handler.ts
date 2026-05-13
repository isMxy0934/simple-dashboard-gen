import "server-only";

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AuthoringApprovalEvent, ViewCheckSnapshot, DatasourceListItemSummary } from "@/ai/authoring/contracts/tool-io";
import type { AuthoringChatSessionPayload } from "@/ai/authoring/contracts/session";
import type { DashboardDocument } from "@/contracts";
import { saveAuthoringChecks } from "@/server/authoring/checks-repository";
import { persistAuthoringChatSessionSnapshot } from "@/server/authoring/chat-session-orchestrator";
import {
  EditingSessionRevisionConflictError,
  openEditingSession,
  saveAppliedEditingSession,
} from "@/server/cloud/editing-session-repository";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import { findLatestApplyPatchOutputFromTranscript } from "@/ai/authoring/runtime/transcript-inspection";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";
import { resolveAppliedEditingSessionConflict } from "@/server/authoring/applied-session-conflict";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRunCheckSnapshots(messages: AgentMessage[]): ViewCheckSnapshot[] {
  // Traverse from end to start, merging by view_id so each view retains its latest state.
  const byViewId = new Map<string, ViewCheckSnapshot>();
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
    for (const check of message.details.checks) {
      if (
        isRecord(check) &&
        typeof check.view_id === "string" &&
        !byViewId.has(check.view_id)
      ) {
        byViewId.set(check.view_id, check as unknown as ViewCheckSnapshot);
      }
    }
  }
  return Array.from(byViewId.values());
}

async function saveAppliedEditingSessionIdempotently(input: {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
  baseVersion: number | null | undefined;
  focusedViewId: string | null | undefined;
  suggestionId: string;
  appliedDashboard: DashboardDocument;
  initialSession: Awaited<ReturnType<typeof openEditingSession>>;
}) {
  const saveFromSession = (
    editingSession: Awaited<ReturnType<typeof openEditingSession>>,
  ) =>
    saveAppliedEditingSession({
      workspaceId: input.workspaceId,
      userId: input.userId,
      dashboardId: input.dashboardId,
      sessionId: input.sessionId,
      baseVersion: input.baseVersion ?? editingSession.sessionPayload.baseVersion,
      canonicalDraft: input.appliedDashboard,
      focusViewId: input.focusedViewId,
      previousPayload: editingSession.sessionPayload,
      lastSuggestionId: input.suggestionId,
      expectedSessionRevision: editingSession.sessionRevision,
      expectedDocumentHash: dashboardDocumentPersistenceFingerprint(
        editingSession.sessionPayload.canonicalDraft,
      ),
    });

  try {
    return await saveFromSession(input.initialSession);
  } catch (error) {
    if (!(error instanceof EditingSessionRevisionConflictError)) {
      throw error;
    }

    const latestSession = await openEditingSession({
      workspaceId: input.workspaceId,
      userId: input.userId,
      dashboardId: input.dashboardId,
      editingSessionId: input.sessionId,
    });
    const resolution = resolveAppliedEditingSessionConflict({
      latestPayload: latestSession.sessionPayload,
      suggestionId: input.suggestionId,
      appliedDashboard: input.appliedDashboard,
    });
    if (resolution === "already_applied") {
      return latestSession.sessionPayload;
    }
    if (resolution !== "same_dashboard") {
      throw error;
    }

    try {
      return await saveFromSession(latestSession);
    } catch (retryError) {
      if (!(retryError instanceof EditingSessionRevisionConflictError)) {
        throw retryError;
      }
      const retryLatestSession = await openEditingSession({
        workspaceId: input.workspaceId,
        userId: input.userId,
        dashboardId: input.dashboardId,
        editingSessionId: input.sessionId,
      });
      const retryResolution = resolveAppliedEditingSessionConflict({
        latestPayload: retryLatestSession.sessionPayload,
        suggestionId: input.suggestionId,
        appliedDashboard: input.appliedDashboard,
      });
      if (
        retryResolution === "already_applied" ||
        retryResolution === "same_dashboard"
      ) {
        return retryLatestSession.sessionPayload;
      }
      throw retryError;
    }
  }
}

export interface OnFinishHandlerContext {
  workspaceId: string;
  userId: string;
  sessionId: string;
  dashboardId: string;
  editingSessionId: string;
  turnId: string | undefined;
  focusedViewId: string | null | undefined;
  baseVersion: number | null | undefined;
  dashboard: DashboardDocument;
  currentSession: AuthoringChatSessionPayload;
  /** Returns the number of messages that existed before this turn started.
   *  Provided as a getter so callers can resolve it after the pool branch. */
  getMessageCountBeforeTurn: () => number;
  datasourcesForRuntime: DatasourceListItemSummary[] | null;
  previousApplySuggestionId: string | null | undefined;
  approvalEvent: AuthoringApprovalEvent | null | undefined;
  rejectedProposalIds: readonly string[];
  getDraftSnapshot: () => AuthoringChatSessionPayload["prompt"]["workingDraft"];
  getLastRunCheckStateSnapshot: () => AuthoringChatSessionPayload["prompt"]["lastRunCheckState"];
  getContextFingerprintSnapshot: () => string;
}

/**
 * Returns the `onFinish` callback passed to `AuthoringAgentSession`.
 * Each of the three persistence chains (checks, editing session, snapshot)
 * is independently error-guarded so a failure in one does not prevent the others.
 */
export function buildAuthoringOnFinishHandler(ctx: OnFinishHandlerContext) {
  return async ({ agentMessages }: { agentMessages: AgentMessage[] }) => {
    await writeSessionTraceEvent({
      sessionId: ctx.sessionId,
      dashboardId: ctx.dashboardId,
      turnId: ctx.turnId,
      scope: "authoring-chat-flow",
      event: "ui_stream_finish",
      payload: { message_count: agentMessages.length },
    });

    // Chain 1: persist run-check snapshots.
    const runCheckSnapshots = extractRunCheckSnapshots(agentMessages);
    if (ctx.dashboardId && runCheckSnapshots.length > 0) {
      await saveAuthoringChecks({
        workspaceId: ctx.workspaceId,
        dashboardId: ctx.dashboardId,
        sessionId: ctx.sessionId,
        checks: runCheckSnapshots,
      }).catch((error) => {
        console.error("[on-finish-handler] saveAuthoringChecks failed:", error);
      });
    }

    // Chain 2: persist session snapshot — required for session recovery.
    // Must run before the editing-session chain so that if it throws, no editing
    // session has been written yet (consistent failure mode). Do NOT swallow errors.
    await persistAuthoringChatSessionSnapshot({
      sessionId: ctx.sessionId,
      dashboardId: ctx.dashboardId,
      previous: ctx.currentSession,
      appendedAgentMessages: agentMessages.slice(ctx.getMessageCountBeforeTurn()),
      dashboard: ctx.dashboard,
      datasources: ctx.datasourcesForRuntime,
      lastContextFingerprint: ctx.getContextFingerprintSnapshot(),
      workingDraft:
        ctx.approvalEvent?.decision === "reject" ? null : ctx.getDraftSnapshot(),
      lastRunCheckState:
        ctx.approvalEvent?.decision === "reject"
          ? null
          : ctx.getLastRunCheckStateSnapshot(),
      rejectedProposalIds: ctx.rejectedProposalIds,
    });

    // Chain 3: persist editing session when a new patch was applied.
    // This is the approval main-line — do NOT swallow errors.
    const applyOutput = findLatestApplyPatchOutputFromTranscript(agentMessages);
    if (
      applyOutput?.dashboard &&
      applyOutput.suggestion_id !== ctx.previousApplySuggestionId
    ) {
      const editingSession = await openEditingSession({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        dashboardId: ctx.dashboardId,
        editingSessionId: ctx.editingSessionId,
      });
      await saveAppliedEditingSessionIdempotently({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        dashboardId: ctx.dashboardId,
        sessionId: ctx.editingSessionId,
        baseVersion: ctx.baseVersion,
        focusedViewId: applyOutput.focused_view_id ?? ctx.focusedViewId,
        suggestionId: applyOutput.suggestion_id,
        appliedDashboard: applyOutput.dashboard,
        initialSession: editingSession,
      });
    }
  };
}
