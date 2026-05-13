import "server-only";

import { getAuthoringAgentPoolEntry } from "@/server/authoring/agent-pool";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";

export interface SteerAuthoringAgentInput {
  routeSessionId: string;
  message: string;
  workspaceId?: string | null;
  userId?: string | null;
  dashboardId?: string | null;
  sessionId?: string | null;
}

export type SteerAuthoringAgentResult =
  | { ok: true; status: 202; sessionId: string }
  | { ok: false; status: 400 | 404 | 409; reason: string; sessionId?: string };

function trimNonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveAuthoringSteerSessionId(
  input: Pick<
    SteerAuthoringAgentInput,
    "routeSessionId" | "workspaceId" | "userId" | "dashboardId" | "sessionId"
  >,
): string {
  const workspaceId = trimNonEmpty(input.workspaceId);
  const userId = trimNonEmpty(input.userId);
  const dashboardId = trimNonEmpty(input.dashboardId);
  const sessionId = trimNonEmpty(input.sessionId);

  if (workspaceId && userId && dashboardId && sessionId) {
    return buildAuthoringCompositeSessionId({
      workspaceId,
      userId,
      dashboardId,
      sessionId,
    });
  }

  return input.routeSessionId.trim();
}

export function steerAuthoringAgentTurn(
  input: SteerAuthoringAgentInput,
): SteerAuthoringAgentResult {
  const message = input.message.trim();
  if (!message) {
    return { ok: false, status: 400, reason: "MISSING_MESSAGE" };
  }

  const sessionId = resolveAuthoringSteerSessionId(input);
  if (!sessionId) {
    return { ok: false, status: 400, reason: "MISSING_SESSION_ID" };
  }

  const poolEntry = getAuthoringAgentPoolEntry(sessionId);
  if (!poolEntry) {
    return {
      ok: false,
      status: 404,
      reason: "NO_ACTIVE_SESSION",
      sessionId,
    };
  }

  const agent = poolEntry.session.piAgent ?? null;
  if (!agent) {
    return {
      ok: false,
      status: 404,
      reason: "AGENT_NOT_INITIALIZED",
      sessionId,
    };
  }

  if (!agent.state.isStreaming) {
    return {
      ok: false,
      status: 409,
      reason: "AGENT_NOT_STREAMING",
      sessionId,
    };
  }

  agent.steer({
    role: "user",
    content: message,
    timestamp: Date.now(),
  });

  return { ok: true, status: 202, sessionId };
}
