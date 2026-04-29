import { z } from "zod";
import type {
  ApplyPatchToolOutput,
  AuthoringDraftOutput,
  AuthoringMessage,
  AuthoringWorkflowSummary,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringRouteDecision } from "@/ai/authoring/contracts/route";
import type {
  AuthoringCapabilityProfile,
  AuthoringScope,
  AuthoringScopeCapabilities,
  AuthoringToolName,
} from "@/ai/authoring/types";

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

function getMessageParts(
  message: Pick<AuthoringMessage, "parts">,
): AuthoringMessage["parts"] {
  return Array.isArray(message.parts) ? message.parts : [];
}

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

export function hasGrantedApplyPatchApproval(input: {
  messages: AuthoringMessage[];
  modelMessages: unknown[];
}): boolean {
  return (
    hasPendingApprovalResponse(input.messages) ||
    hasGrantedApplyPatchApprovalInModelMessages(input.modelMessages)
  );
}

export function findLatestDraftOutput(
  messages: AuthoringMessage[],
): AuthoringDraftOutput | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...getMessageParts(message)].reverse()) {
      if (
        part.type === "tool-composePatch" &&
        part.state === "output-available" &&
        part.output &&
        typeof part.output === "object" &&
        "suggestion" in part.output &&
        (part.output as AuthoringDraftOutput).suggestion.dashboard
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
    for (const part of [...getMessageParts(message)].reverse()) {
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

export function hasPendingToolApproval(messages: AuthoringMessage[]) {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...getMessageParts(message)].reverse()) {
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
    for (const part of [...getMessageParts(message)].reverse()) {
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
    for (const part of [...getMessageParts(message)].reverse()) {
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
    for (const part of [...getMessageParts(message)].reverse()) {
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
): AuthoringScopeCapabilities | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];

    const parts = getMessageParts(message);
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part.type === "data-authoring_scope") {
        return normalizeAuthoringScopeCapabilities(part.data);
      }
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCapabilityProfile(value: unknown): AuthoringCapabilityProfile {
  if (
    value === "chat" ||
    value === "explore" ||
    value === "author-dashboard" ||
    value === "author-focused" ||
    value === "approval"
  ) {
    return value;
  }
  return "chat";
}

function normalizeAuthoringScope(value: unknown): AuthoringScope {
  if (!isRecord(value)) {
    return { kind: "dashboard" };
  }
  if (value.kind === "focused" && typeof value.viewId === "string") {
    return { kind: "focused", viewId: value.viewId };
  }
  if (value.kind === "empty") {
    return { kind: "empty" };
  }
  return { kind: "dashboard" };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeScopeResolution(
  value: unknown,
  scope: AuthoringScope,
): AuthoringScopeCapabilities["scopeResolution"] {
  if (
    isRecord(value) &&
    (value.effective_scope === "dashboard" || value.effective_scope === "focused") &&
    (typeof value.selected_view_id === "string" || value.selected_view_id === null) &&
    typeof value.scope_reason === "string" &&
    typeof value.requires_scope_clarification === "boolean"
  ) {
    return value as unknown as AuthoringScopeCapabilities["scopeResolution"];
  }

  const effectiveScope = scope.kind === "focused" ? "focused" : "dashboard";
  return {
    effective_scope: effectiveScope,
    selected_view_id: scope.kind === "focused" ? scope.viewId : null,
    scope_reason: scope.kind === "focused" ? "selected_view" : "no_selection",
    requires_scope_clarification: false,
  };
}

function normalizeAuthoringScopeCapabilities(
  value: unknown,
): AuthoringScopeCapabilities | null {
  if (!isRecord(value)) {
    return null;
  }

  const profile = normalizeCapabilityProfile(value.profile ?? value.mode);
  const scope = normalizeAuthoringScope(value.scope);
  const legacyActiveTools = value.activeTools;
  const allowedTools = normalizeStringArray(
    value.allowedTools ?? legacyActiveTools,
  ) as AuthoringToolName[];
  const scopeResolution = normalizeScopeResolution(value.scopeResolution, scope);

  return {
    profile,
    scope,
    scopeResolution,
    allowedTools,
    contextBlockVariant:
      value.contextBlockVariant === "focused" ||
      value.contextBlockVariant === "empty" ||
      value.contextBlockVariant === "dashboard"
        ? value.contextBlockVariant
        : scope.kind === "focused"
          ? "focused"
          : "dashboard",
    relevantSkillIds: normalizeStringArray(value.relevantSkillIds),
    stopReason:
      value.stopReason === "approval-applied" ? "approval-applied" : null,
  };
}

export function findLatestAuthoringRoute(
  messages: AuthoringMessage[],
): AuthoringRouteDecision | null {
  const scope = findLatestAuthoringScope(messages);
  if (!scope) {
    return null;
  }

  return {
    route: scope.profile === "chat" ? "chat" : scope.profile === "approval" ? "approval" : "authoring",
    summary: scope.profile,
    user_goal: "",
    signals: [scope.profile],
  };
}
export function findLatestWorkflow(
  messages: AuthoringMessage[],
): AuthoringWorkflowSummary | null {
  const scope = findLatestAuthoringScope(messages);
  if (!scope) {
    return null;
  }

  const activeStage =
    scope.profile === "approval"
      ? "approval"
      : scope.profile === "chat"
        ? "chat"
        : scope.profile === "explore"
            ? "explore"
            : "author";

  return {
    route: scope.profile === "chat" ? "chat" : scope.profile === "approval" ? "approval" : "authoring",
    mode: scope.profile,
    active_stage: activeStage,
    summary: scope.profile,
    active_tools: [...scope.allowedTools],
    skill_ids: [...scope.relevantSkillIds],
    approval_required: scope.profile === "approval",
    stages: [
      {
        id: "explore",
        title: "Inspect State",
        description: "Read dashboard state, datasource schema, and checks.",
        status:
          activeStage === "chat"
            ? "pending"
            : activeStage === "explore"
              ? "active"
              : "complete",
      },
      {
        id: "author",
        title: "Stage Changes",
        description: "Stage view, query, and binding edits.",
        status:
          activeStage === "chat" ||
          activeStage === "explore"
            ? "pending"
            : activeStage === "author"
              ? "active"
              : "complete",
      },
      {
        id: "approval",
        title: "Request Approval",
        description: "Apply the staged patch once approved.",
        status: activeStage === "approval" ? "active" : "pending",
      },
    ],
  };
}
