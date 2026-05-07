import type {
  AuthoringCapabilityProfile,
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
  | "approval_mismatch"
  | "authoring"
  | "approval_apply";

export interface RuntimeToolSurface {
  mode: RuntimeToolSurfaceMode;
  activeTools: AuthoringToolName[];
  toolChoice: AuthoringToolChoice;
  promptSections: string[];
  reason?: RuntimeToolSurfaceReason;
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
        : input.reason === "approval_mismatch"
          ? "approval-mismatch"
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
}): RuntimeToolSurface {
  return {
    mode: "author",
    activeTools: uniqueTools(authorActiveTools(input.allowedTools)),
    toolChoice: "auto",
    promptSections: ["identity", "authoring", scopePromptSection(input.scope)],
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
