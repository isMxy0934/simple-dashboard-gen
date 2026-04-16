import { z } from "zod";
import type {
  MainAgentDraftOutput,
  ApplyPatchToolOutput,
  MainAgentWorkflowSummary,
  MainAgentMessage,
} from "@/ai/main-agent/contracts/agent-contract";
import type { MainAgentRouteDecision } from "@/ai/main-agent/contracts/route";

/** Model messages use approvalId to link request/response; they do not carry toolName on responses. */
const assistantToolCallSchema = z.object({
  type: z.literal("tool-call"),
  toolName: z.string(),
});

const assistantApprovalRequestSchema = z.object({
  type: z.literal("tool-approval-request"),
  approvalId: z.string(),
});

const toolApprovalResponseSchema = z.object({
  type: z.literal("tool-approval-response"),
  approvalId: z.string(),
  approved: z.boolean(),
});

const modelMessageShellSchema = z.object({
  role: z.string().optional(),
  content: z.array(z.unknown()).optional(),
});

/**
 * Collects approvalIds for applyPatch from assistant model messages by pairing
 * each tool-approval-request with the immediately preceding tool-call.
 */
function collectApplyPatchApprovalIdsFromAssistantModelMessages(
  modelMessages: unknown[],
): Set<string> {
  const ids = new Set<string>();

  for (const msg of modelMessages) {
    const shell = modelMessageShellSchema.safeParse(msg);
    if (!shell.success || shell.data.role !== "assistant" || !Array.isArray(shell.data.content)) {
      continue;
    }

    let lastToolName: string | undefined;

    for (const part of shell.data.content) {
      const call = assistantToolCallSchema.safeParse(part);
      if (call.success) {
        lastToolName = call.data.toolName;
        continue;
      }

      const req = assistantApprovalRequestSchema.safeParse(part);
      if (req.success) {
        if (lastToolName === "applyPatch") {
          ids.add(req.data.approvalId);
        }
        lastToolName = undefined;
      }
    }
  }

  return ids;
}

/**
 * True when model messages contain a granted approval for applyPatch (tool role
 * tool-approval-response whose approvalId matches an applyPatch tool-approval-request).
 * Use together with {@link hasPendingApprovalResponse} on UI messages for one logical gate.
 */
export function hasGrantedApplyPatchApprovalInModelMessages(
  modelMessages: unknown[],
): boolean {
  const applyPatchIds = collectApplyPatchApprovalIdsFromAssistantModelMessages(modelMessages);
  if (applyPatchIds.size === 0) {
    return false;
  }

  for (const msg of modelMessages) {
    const shell = modelMessageShellSchema.safeParse(msg);
    if (!shell.success || shell.data.role !== "tool" || !Array.isArray(shell.data.content)) {
      continue;
    }

    for (const part of shell.data.content) {
      const res = toolApprovalResponseSchema.safeParse(part);
      if (
        res.success &&
        res.data.approved === true &&
        applyPatchIds.has(res.data.approvalId)
      ) {
        return true;
      }
    }
  }

  return false;
}

export function findLatestDraftOutput(
  messages: MainAgentMessage[],
): MainAgentDraftOutput | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type === "tool-composePatch" &&
        part.state === "output-available" &&
        part.output &&
        typeof part.output === "object" &&
        "suggestion" in part.output
      ) {
        return part.output as MainAgentDraftOutput;
      }
    }
  }

  return null;
}

export function findDraftOutputBySuggestionId(
  messages: MainAgentMessage[],
  suggestionId: string,
): MainAgentDraftOutput | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type === "tool-composePatch" &&
        part.state === "output-available" &&
        part.output &&
        typeof part.output === "object" &&
        "suggestion" in part.output
      ) {
        const output = part.output as MainAgentDraftOutput;
        if (output.suggestion.id === suggestionId) {
          return output;
        }
      }
    }
  }

  return null;
}

export function findLatestApplyPatchApproval(messages: MainAgentMessage[]): {
  approvalId: string;
  suggestionId: string | null;
} | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type === "tool-applyPatch" &&
        part.state === "approval-requested"
      ) {
        return {
          approvalId: part.approval.id,
          suggestionId:
            part.input &&
            typeof part.input === "object" &&
            "suggestion_id" in part.input &&
            typeof part.input.suggestion_id === "string"
              ? part.input.suggestion_id
              : null,
        };
      }
    }
  }

  return null;
}

export function hasPendingToolApproval(messages: MainAgentMessage[]) {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type.startsWith("tool-") &&
        "state" in part &&
        part.state === "approval-requested"
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns true when a tool call was approved by the user (state = "approval-responded"
 * with approved = true) but has not yet been executed. This signals Round 2 of the
 * approval flow: the agent should run with only applyPatch available so it can
 * complete the approved operation without re-requesting approval.
 */
export function hasPendingApprovalResponse(messages: MainAgentMessage[]) {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type === "tool-applyPatch" &&
        "state" in part &&
        part.state === "approval-responded" &&
        "approval" in part &&
        typeof part.approval === "object" &&
        part.approval !== null &&
        "approved" in part.approval &&
        part.approval.approved === true
      ) {
        return true;
      }
    }
  }

  return false;
}

export function hasRejectedApprovalResponse(messages: MainAgentMessage[]) {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type === "tool-applyPatch" &&
        "state" in part &&
        part.state === "approval-responded" &&
        "approval" in part &&
        typeof part.approval === "object" &&
        part.approval !== null &&
        "approved" in part.approval &&
        part.approval.approved === false
      ) {
        return true;
      }
    }
  }

  return false;
}

export function findLatestApplyPatchOutput(
  messages: MainAgentMessage[],
): ApplyPatchToolOutput | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type === "tool-applyPatch" &&
        part.state === "output-available" &&
        part.output &&
        typeof part.output === "object" &&
        "suggestion_id" in part.output
      ) {
        return part.output as ApplyPatchToolOutput;
      }
    }
  }

  return null;
}

export function findLatestMainAgentRoute(
  messages: MainAgentMessage[],
): MainAgentRouteDecision | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.type === "data-main_agent_route") {
        return part.data as MainAgentRouteDecision;
      }
    }
  }

  return null;
}

export function findLatestWorkflow(
  messages: MainAgentMessage[],
): MainAgentWorkflowSummary | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.type === "data-main_agent_workflow") {
        return part.data as MainAgentWorkflowSummary;
      }
    }
  }

  return null;
}
