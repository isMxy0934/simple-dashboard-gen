import { z } from "zod";
import type {
  ApplyPatchToolOutput,
  AuthoringDraftOutput,
  AuthoringMessage,
  AuthoringWorkflowSummary,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringRouteDecision } from "@/ai/authoring/contracts/route";
import type { AuthoringScopeDecision } from "@/ai/authoring/types";

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
  messages: AuthoringMessage[],
): AuthoringDraftOutput | null {
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
        return part.output as AuthoringDraftOutput;
      }
    }
  }

  return null;
}

export function findDraftOutputBySuggestionId(
  messages: AuthoringMessage[],
  suggestionId: string,
): AuthoringDraftOutput | null {
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
        const output = part.output as AuthoringDraftOutput;
        if (output.suggestion.id === suggestionId) {
          return output;
        }
      }
    }
  }

  return null;
}

export function findLatestApplyPatchApproval(messages: AuthoringMessage[]): {
  approvalId: string;
  suggestionId: string | null;
} | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (part.type === "tool-applyPatch" && part.state === "approval-requested") {
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

export function hasPendingToolApproval(messages: AuthoringMessage[]) {
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

export function hasPendingApprovalResponse(messages: AuthoringMessage[]) {
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

export function hasRejectedApprovalResponse(messages: AuthoringMessage[]) {
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
  messages: AuthoringMessage[],
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

export function findLatestAuthoringScope(
  messages: AuthoringMessage[],
): AuthoringScopeDecision | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.type === "data-authoring_scope") {
        return part.data as AuthoringScopeDecision;
      }
    }
  }

  return null;
}

export function findLatestAuthoringRoute(
  messages: AuthoringMessage[],
): AuthoringRouteDecision | null {
  const scope = findLatestAuthoringScope(messages);
  if (!scope) {
    return null;
  }

  return {
    route: scope.mode === "chat" ? "chat" : scope.mode === "approval" ? "approval" : "authoring",
    summary: scope.mode,
    user_goal: "",
    signals: [scope.mode],
  };
}
export function findLatestWorkflow(
  messages: AuthoringMessage[],
): AuthoringWorkflowSummary | null {
  const scope = findLatestAuthoringScope(messages);
  if (!scope) {
    return null;
  }

  const mode =
    scope.mode === "approval"
      ? "approval"
      : scope.mode === "chat" || scope.mode === "explore"
        ? "read"
        : "write";

  return {
    route: scope.mode === "chat" ? "chat" : scope.mode === "approval" ? "approval" : "authoring",
    mode,
    active_stage: mode,
    summary: scope.mode,
    active_tools: [...scope.activeTools],
    skill_ids: [...scope.relevantSkillIds],
    approval_required: scope.mode === "approval",
    stages: [
      {
        id: "read",
        title: "Inspect State",
        description: "Read dashboard state and inspect when needed.",
        status: mode === "read" ? "active" : "complete",
      },
      {
        id: "write",
        title: "Stage Changes",
        description: "Stage view, query, and binding edits.",
        status:
          mode === "read"
            ? "pending"
            : mode === "write"
              ? "active"
              : "complete",
      },
      {
        id: "approval",
        title: "Request Approval",
        description: "Apply the staged patch once approved.",
        status: mode === "approval" ? "active" : "pending",
      },
    ],
  };
}
