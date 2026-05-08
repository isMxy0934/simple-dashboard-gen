import type {
  AuthoringCapabilityProfile,
  AuthoringScopeCapabilities,
  AuthoringToolChoice,
  AuthoringToolName,
} from "@/ai/authoring/contracts/runtime";
import type { AuthoringToolSet } from "@/ai/authoring/tools/definition";
import {
  getReadToolNamesForScope,
  isCanonicalAuthoringToolName,
} from "@/ai/authoring/tools/registry";

/**
 * Authoring tool surface mode.
 *
 * Maps to {@link AuthoringModeStageId} in mode-summary.ts:
 * "chat" → "chat", "inspect" → "explore", "author" → "author", "approval" → "approval"
 */
export type RuntimeToolSurfaceMode = "chat" | "inspect" | "author" | "approval";

export type RuntimeToolSurfaceReason =
  | "scope_blocked"
  | "chat_only"
  | "authoring"
  | "approval_apply";

export interface RuntimeToolSurface {
  mode: RuntimeToolSurfaceMode;
  activeTools: AuthoringToolName[];
  toolChoice: AuthoringToolChoice;
  promptSections: string[];
  reason?: RuntimeToolSurfaceReason;
}

export interface RuntimeToolSurfacePolicyInput {
  decision: AuthoringScopeCapabilities;
  draft?: {
    hasDraft: boolean;
    canCompose: boolean;
    blockers: readonly string[];
  } | null;
  approval?: {
    decision?: "approve" | "reject" | null;
  } | null;
  forceChatOnlyForTurn?: boolean;
}

function uniqueTools(tools: AuthoringToolName[]): AuthoringToolName[] {
  return [...new Set(tools)];
}

function scopeName(scope: { kind: string }): "dashboard" | "focused" {
  return scope.kind === "focused" ? "focused" : "dashboard";
}

function scopePromptSection(scope: { kind: string }): string {
  return scope.kind === "focused" ? "focused" : "dashboard";
}

function authorActiveTools(allowedTools: AuthoringToolName[]): AuthoringToolName[] {
  return allowedTools.filter((toolName) => toolName !== "applyPatch");
}

function isStaleCheckOnlyDraft(input: {
  hasDraft: boolean;
  canCompose: boolean;
  blockers: readonly string[];
} | null | undefined): boolean {
  return Boolean(
    input?.hasDraft &&
      !input.canCompose &&
      input.blockers.length === 1 &&
      input.blockers[0] === "stale_check",
  );
}

export function applyAuthoringDraftToolPolicy(input: {
  allowedTools: AuthoringToolName[];
  draft: {
    hasDraft: boolean;
    canCompose: boolean;
    blockers: readonly string[];
  } | null | undefined;
}): AuthoringToolName[] {
  if (isStaleCheckOnlyDraft(input.draft)) {
    const allowed = new Set(input.allowedTools);
    return (["getDraftStatus", "runCheck"] as AuthoringToolName[]).filter((toolName) =>
      allowed.has(toolName),
    );
  }
  return input.allowedTools;
}

export function buildChatToolSurface(input: {
  scope: { kind: string };
  reason: RuntimeToolSurfaceReason;
}): RuntimeToolSurface {
  return {
    mode: "chat",
    activeTools: [],
    toolChoice: "none",
    promptSections: [
      "identity",
      input.reason === "scope_blocked"
        ? "focused-scope-blocker"
        : "chat",
      scopePromptSection(input.scope),
    ],
    reason: input.reason,
  };
}

export function buildInspectToolSurface(input: {
  scope: { kind: string };
  profile?: AuthoringCapabilityProfile;
  allowedTools?: AuthoringToolName[];
}): RuntimeToolSurface {
  const readScope = scopeName(input.scope);
  const includeDeclaration =
    input.profile === undefined ||
    input.profile === "author-dashboard" ||
    input.profile === "author-focused";
  const defaultTools = uniqueTools([
    ...getReadToolNamesForScope(readScope),
    ...(includeDeclaration ? ["declareAuthoringGoal" as const] : []),
  ]);
  const allowedToolNames = input.allowedTools
    ? new Set(input.allowedTools)
    : null;
  return {
    mode: "inspect",
    activeTools: allowedToolNames
      ? defaultTools.filter((toolName) => allowedToolNames.has(toolName))
      : defaultTools,
    toolChoice: "auto",
    promptSections: ["identity", "inspect", scopePromptSection(input.scope)],
  };
}

export function buildAuthorToolSurface(input: {
  scope: { kind: string };
  allowedTools: AuthoringToolName[];
  promptSections?: string[];
  toolChoice?: AuthoringToolChoice;
}): RuntimeToolSurface {
  return {
    mode: "author",
    activeTools: uniqueTools(authorActiveTools(input.allowedTools)),
    toolChoice: input.toolChoice ?? "auto",
    promptSections: input.promptSections ?? [
      "identity",
      "authoring",
      scopePromptSection(input.scope),
    ],
    reason: "authoring",
  };
}

export function buildApprovalToolSurface(input: {
  scope: { kind: string };
}): RuntimeToolSurface {
  return {
    mode: "approval",
    activeTools: ["applyPatch"],
    toolChoice: "auto",
    promptSections: ["identity", "approval", scopePromptSection(input.scope)],
    reason: "approval_apply",
  };
}

export function resolveRuntimeToolSurface(
  input: RuntimeToolSurfacePolicyInput,
): RuntimeToolSurface {
  const decision = input.decision;
  if (input.forceChatOnlyForTurn) {
    return buildChatToolSurface({ scope: decision.scope, reason: "chat_only" });
  }
  if (input.approval?.decision === "approve") {
    return buildApprovalToolSurface({ scope: decision.scope });
  }
  if (input.approval?.decision === "reject") {
    return buildChatToolSurface({ scope: decision.scope, reason: "chat_only" });
  }
  if (decision.allowedTools.length === 0) {
    return buildChatToolSurface({
      scope: decision.scope,
      reason: decision.scopeResolution.requires_scope_clarification
        ? "scope_blocked"
        : "chat_only",
    });
  }
  if (decision.profile === "explore") {
    return buildInspectToolSurface({
      scope: decision.scope,
      profile: decision.profile,
      allowedTools: decision.allowedTools,
    });
  }
  if (decision.profile === "author-dashboard" || decision.profile === "author-focused") {
    const staleCheckOnly = isStaleCheckOnlyDraft(input.draft);
    const allowedTools = applyAuthoringDraftToolPolicy({
      allowedTools: decision.allowedTools,
      draft: input.draft,
    });
    return buildAuthorToolSurface({
      scope: decision.scope,
      allowedTools,
      promptSections: staleCheckOnly
        ? [
            "identity",
            "authoring",
            "draft-runtime-check",
            scopePromptSection(decision.scope),
          ]
        : undefined,
      toolChoice:
        staleCheckOnly && allowedTools.includes("runCheck")
          ? { type: "tool", toolName: "runCheck" }
          : undefined,
    });
  }
  return buildChatToolSurface({ scope: decision.scope, reason: "chat_only" });
}

export function selectAuthoringToolSet(input: {
  tools: AuthoringToolSet;
  activeTools: readonly AuthoringToolName[];
}): AuthoringToolSet {
  const selected = new Set(input.activeTools);
  return Object.fromEntries(
    Object.entries(input.tools).filter(([toolName]) =>
      selected.has(toolName as AuthoringToolName),
    ),
  ) satisfies AuthoringToolSet;
}

export function surfaceConfigDigest(surface: RuntimeToolSurface): string {
  return `${surface.mode}:${[...surface.activeTools].sort().join(",")}:${surface.toolChoice}:${[...surface.promptSections].sort().join(",")}`;
}

export function normalizeActiveAuthoringToolName(
  toolName: string,
): AuthoringToolName | null {
  return isCanonicalAuthoringToolName(toolName) ? toolName : null;
}
