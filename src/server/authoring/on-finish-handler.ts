import "server-only";

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ViewCheckSnapshot, DatasourceListItemSummary } from "@/ai/authoring/contracts/tool-io";
import type { AuthoringChatSessionPayload } from "@/ai/authoring/contracts/session";
import type { DashboardDocument } from "@/contracts";
import { saveAuthoringChecks } from "@/server/authoring/checks-repository";
import { persistAuthoringChatSessionSnapshot } from "@/server/authoring/chat-session-orchestrator";
import {
  openEditingSession,
  saveAppliedEditingSession,
} from "@/server/cloud/editing-session-repository";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import { findLatestApplyPatchOutputFromTranscript } from "@/ai/authoring/runtime/transcript-inspection";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";

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
    return message.details.checks.filter(
      (check): check is ViewCheckSnapshot =>
        isRecord(check) && typeof check.view_id === "string",
    );
  }
  return [];
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

    // Chain 2: persist editing session when a new patch was applied.
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
        sessionId: ctx.editingSessionId,
      });
      await saveAppliedEditingSession({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        dashboardId: ctx.dashboardId,
        sessionId: ctx.editingSessionId,
        baseVersion: ctx.baseVersion ?? editingSession.sessionPayload.baseVersion,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        canonicalDraft: applyOutput.dashboard!,
        focusViewId: applyOutput.focused_view_id ?? ctx.focusedViewId,
        previousPayload: editingSession.sessionPayload,
        lastSuggestionId: applyOutput.suggestion_id,
        expectedSessionRevision: editingSession.sessionRevision,
        expectedDocumentHash: dashboardDocumentPersistenceFingerprint(
          editingSession.sessionPayload.canonicalDraft,
        ),
      });
    }

    // Chain 3: persist session snapshot — required for session recovery.
    // Do NOT swallow errors.
    await persistAuthoringChatSessionSnapshot({
      sessionId: ctx.sessionId,
      dashboardId: ctx.dashboardId,
      previous: ctx.currentSession,
      appendedAgentMessages: agentMessages.slice(ctx.getMessageCountBeforeTurn()),
      dashboard: ctx.dashboard,
      datasources: ctx.datasourcesForRuntime,
      lastContextFingerprint: ctx.getContextFingerprintSnapshot(),
      workingDraft: ctx.getDraftSnapshot(),
      lastRunCheckState: ctx.getLastRunCheckStateSnapshot(),
    });
  };
}
