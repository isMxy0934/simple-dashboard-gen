import type {
  DashboardAgentMessage,
  DashboardAgentPatchApprovalPayload,
} from "@/ai/dashboard-agent/contracts/agent-contract";
import { findLatestApplyPatchApproval } from "@/ai/dashboard-agent/messages/message-inspection";

/**
 * `data-*` part keys on assistant messages that are **never** sent to the model.
 * Register every client-only key here; stripping iterates this list only.
 */
export const DASHBOARD_AGENT_CLIENT_ONLY_DATA_KEYS = [
  "dashboard_agent_patch_approval",
] as const;

export type DashboardAgentClientOnlyDataKey =
  (typeof DASHBOARD_AGENT_CLIENT_ONLY_DATA_KEYS)[number];

const CLIENT_ONLY_PART_TYPES: ReadonlySet<string> = new Set(
  DASHBOARD_AGENT_CLIENT_ONLY_DATA_KEYS.map((key) => `data-${key}`),
);

export function isDashboardAgentClientOnlyDataPartType(partType: string): boolean {
  return CLIENT_ONLY_PART_TYPES.has(partType);
}

export const DASHBOARD_AGENT_PATCH_APPROVAL_DATA_KEY: DashboardAgentClientOnlyDataKey =
  "dashboard_agent_patch_approval";

export const DASHBOARD_AGENT_PATCH_APPROVAL_PART_TYPE =
  `data-${DASHBOARD_AGENT_PATCH_APPROVAL_DATA_KEY}` as const;

export type { DashboardAgentPatchApprovalPayload };

function stripClientOnlyPartsFromAssistantMessages(
  messages: DashboardAgentMessage[],
): DashboardAgentMessage[] {
  const next = messages.map((m) => {
    if (m.role !== "assistant") {
      return m;
    }
    const parts = m.parts.filter(
      (p) => !isDashboardAgentClientOnlyDataPartType(p.type),
    );
    return { ...m, parts };
  });
  return next.filter(
    (m) => !(m.role === "assistant" && m.parts.length === 0),
  );
}

function findAssistantMessageIndexWithApplyPatchApproval(
  messages: DashboardAgentMessage[],
  approvalId: string,
): number {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts) {
      if (
        part.type === "tool-applyPatch" &&
        part.state === "approval-requested" &&
        part.approval.id === approvalId
      ) {
        return i;
      }
    }
  }
  return -1;
}

function dashboardAgentMessagesSyncFingerprint(
  messages: DashboardAgentMessage[],
): string {
  return JSON.stringify(
    messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts.map((p) => {
        if (p.type.startsWith("data-")) {
          const d = p as { type: string; data?: unknown };
          return { type: p.type, data: d.data };
        }
        if (p.type.startsWith("tool-")) {
          const t = p as {
            type: string;
            state?: string;
            approval?: { id?: string };
          };
          return {
            type: p.type,
            state: t.state,
            approvalId: t.approval?.id,
          };
        }
        if (p.type === "text") {
          const tx = p as { type: "text"; text: string };
          return { type: "text", text: tx.text };
        }
        if (p.type === "reasoning") {
          const r = p as { type: "reasoning"; text: string };
          return { type: "reasoning", text: r.text };
        }
        return { type: p.type };
      }),
    })),
  );
}

/** Removes all {@link DASHBOARD_AGENT_CLIENT_ONLY_DATA_KEYS} data parts before agent / transport. */
export function stripDashboardAgentMessagesForModel(
  messages: DashboardAgentMessage[],
): DashboardAgentMessage[] {
  return stripClientOnlyPartsFromAssistantMessages(messages);
}

/**
 * Ensures a single patch-approval UI part exists on the **same** assistant message
 * as `tool-applyPatch` (approval-requested), so `useChat.addToolApprovalResponse`
 * still targets the last assistant message correctly.
 */
export function syncDashboardAgentPatchApprovalUi(
  messages: DashboardAgentMessage[],
): { messages: DashboardAgentMessage[]; changed: boolean } {
  const base = stripClientOnlyPartsFromAssistantMessages(messages);
  const pending = findLatestApplyPatchApproval(base);

  if (!pending) {
    const changed =
      dashboardAgentMessagesSyncFingerprint(messages) !==
      dashboardAgentMessagesSyncFingerprint(base);
    return { messages: base, changed };
  }

  const anchorIndex = findAssistantMessageIndexWithApplyPatchApproval(
    base,
    pending.approvalId,
  );
  if (anchorIndex < 0) {
    const changed =
      dashboardAgentMessagesSyncFingerprint(messages) !==
      dashboardAgentMessagesSyncFingerprint(base);
    return { messages: base, changed };
  }

  const anchor = base[anchorIndex];
  const uiPart: DashboardAgentMessage["parts"][number] = {
    type: DASHBOARD_AGENT_PATCH_APPROVAL_PART_TYPE,
    data: {
      approvalId: pending.approvalId,
      suggestionId: pending.suggestionId,
    },
  };

  const next = [...base];
  next[anchorIndex] = {
    ...anchor,
    parts: [...anchor.parts, uiPart],
  };

  const changed =
    dashboardAgentMessagesSyncFingerprint(messages) !==
    dashboardAgentMessagesSyncFingerprint(next);
  return { messages: next, changed };
}
