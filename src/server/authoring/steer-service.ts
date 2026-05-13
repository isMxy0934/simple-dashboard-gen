import "server-only";

import { getAuthoringAgentPoolEntry } from "@/server/authoring/agent-pool";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";

export interface SteerAuthoringAgentInput {
  routeChatSessionId: string;
  message: string;
  workspaceId: string;
  userId: string;
  dashboardId: string;
  chatSessionId: string;
}

export type SteerAuthoringAgentResult =
  | { ok: true; status: 202; sessionId: string }
  | { ok: false; status: 400 | 404 | 409; reason: string; sessionId?: string };

export function resolveAuthoringSteerSessionId(
  input: Pick<
    SteerAuthoringAgentInput,
    "workspaceId" | "userId" | "dashboardId" | "chatSessionId"
  >,
): string {
  return buildAuthoringCompositeSessionId({
    workspaceId: input.workspaceId.trim(),
    userId: input.userId.trim(),
    dashboardId: input.dashboardId.trim(),
    sessionId: input.chatSessionId.trim(),
  });
}

export function steerAuthoringAgentTurn(
  input: SteerAuthoringAgentInput,
): SteerAuthoringAgentResult {
  const message = input.message.trim();
  if (!message) {
    return { ok: false, status: 400, reason: "MISSING_MESSAGE" };
  }

  const sessionId = resolveAuthoringSteerSessionId(input);

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
