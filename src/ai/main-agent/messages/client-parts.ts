import type {
  MainAgentMessage,
  MainAgentPatchApprovalPayload,
} from "@/ai/main-agent/contracts/agent-contract";
import { findLatestApplyPatchApproval } from "@/ai/main-agent/messages/message-inspection";

/**
 * `data-*` part keys on assistant messages that are **never** sent to the model.
 * Register every client-only key here; stripping iterates this list only.
 */
export const MAIN_AGENT_CLIENT_ONLY_DATA_KEYS = [
  "main_agent_patch_approval",
] as const;

export type MainAgentClientOnlyDataKey =
  (typeof MAIN_AGENT_CLIENT_ONLY_DATA_KEYS)[number];

const CLIENT_ONLY_PART_TYPES: ReadonlySet<string> = new Set(
  MAIN_AGENT_CLIENT_ONLY_DATA_KEYS.map((key) => `data-${key}`),
);
const MODEL_DEDUPED_ASSISTANT_PART_TYPES = new Set([
  "data-main_agent_route",
  "data-main_agent_workflow",
  "data-view_list_summary",
  "data-view_check_updates",
]);

export function isMainAgentClientOnlyDataPartType(partType: string): boolean {
  return CLIENT_ONLY_PART_TYPES.has(partType);
}

export const MAIN_AGENT_PATCH_APPROVAL_DATA_KEY: MainAgentClientOnlyDataKey =
  "main_agent_patch_approval";

export const MAIN_AGENT_PATCH_APPROVAL_PART_TYPE =
  `data-${MAIN_AGENT_PATCH_APPROVAL_DATA_KEY}` as const;

export type { MainAgentPatchApprovalPayload };

function removeClientOnlyPartsFromAssistantMessages(
  messages: MainAgentMessage[],
): MainAgentMessage[] {
  const next = messages.map((m) => {
    if (m.role !== "assistant") {
      return m;
    }
    const parts = m.parts.filter(
      (p) => !isMainAgentClientOnlyDataPartType(p.type),
    );
    return { ...m, parts };
  });
  return next.filter(
    (m) => !(m.role === "assistant" && m.parts.length === 0),
  );
}

function compactAssistantMessageParts(
  parts: MainAgentMessage["parts"],
): MainAgentMessage["parts"] {
  const deduped = dedupeAssistantParts(parts).filter(
    (part) => part.type !== "step-start",
  );
  const lastTextIndex = findLastTextIndex(deduped);
  const hasToolPart = deduped.some((part) => part.type.startsWith("tool-"));

  if (!hasToolPart || lastTextIndex < 0) {
    return deduped;
  }

  return deduped.filter(
    (part, index) => part.type !== "text" || index === lastTextIndex,
  );
}

function dedupeAssistantParts(
  parts: MainAgentMessage["parts"],
): MainAgentMessage["parts"] {
  const lastIndexByType = new Map<string, number>();

  parts.forEach((part, index) => {
    if (MODEL_DEDUPED_ASSISTANT_PART_TYPES.has(part.type)) {
      lastIndexByType.set(part.type, index);
    }
  });

  return parts.filter((part, index) => {
    if (!MODEL_DEDUPED_ASSISTANT_PART_TYPES.has(part.type)) {
      return true;
    }

    return lastIndexByType.get(part.type) === index;
  });
}

function findLastTextIndex(parts: MainAgentMessage["parts"]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.type === "text") {
      return index;
    }
  }

  return -1;
}

function findAssistantMessageIndexWithApplyPatchApproval(
  messages: MainAgentMessage[],
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

function mainAgentMessagesSyncFingerprint(
  messages: MainAgentMessage[],
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

/** Removes all {@link MAIN_AGENT_CLIENT_ONLY_DATA_KEYS} data parts before agent / transport. */
export function stripMainAgentMessagesForModel(
  messages: MainAgentMessage[],
): MainAgentMessage[] {
  return removeClientOnlyPartsFromAssistantMessages(messages).map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    return {
      ...message,
      parts: compactAssistantMessageParts(message.parts),
    };
  });
}

/**
 * Ensures a single patch-approval UI part exists on the **same** assistant message
 * as `tool-applyPatch` (approval-requested), so `useChat.addToolApprovalResponse`
 * still targets the last assistant message correctly.
 */
export function syncMainAgentPatchApprovalUi(
  messages: MainAgentMessage[],
): { messages: MainAgentMessage[]; changed: boolean } {
  const base = removeClientOnlyPartsFromAssistantMessages(messages);
  const pending = findLatestApplyPatchApproval(base);

  if (!pending) {
    const changed =
      mainAgentMessagesSyncFingerprint(messages) !==
      mainAgentMessagesSyncFingerprint(base);
    return { messages: base, changed };
  }

  const anchorIndex = findAssistantMessageIndexWithApplyPatchApproval(
    base,
    pending.approvalId,
  );
  if (anchorIndex < 0) {
    const changed =
      mainAgentMessagesSyncFingerprint(messages) !==
      mainAgentMessagesSyncFingerprint(base);
    return { messages: base, changed };
  }

  const anchor = base[anchorIndex];
  const uiPart: MainAgentMessage["parts"][number] = {
    type: MAIN_AGENT_PATCH_APPROVAL_PART_TYPE,
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
    mainAgentMessagesSyncFingerprint(messages) !==
    mainAgentMessagesSyncFingerprint(next);
  return { messages: next, changed };
}
