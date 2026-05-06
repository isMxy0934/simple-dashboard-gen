import type { AuthoringToolName } from "@/ai/authoring/contracts/runtime";
import type { AuthoringCapabilityProfile } from "@/ai/authoring/contracts/runtime";
import type { AuthoringToolSet } from "@/ai/authoring/tools/definition";
import {
  getReadToolNamesForScope,
  isCanonicalAuthoringToolName,
} from "@/ai/authoring/tools/registry";
import type {
  ToolStep,
  WorkflowAction,
} from "@/ai/authoring/workflow/types";

export type RuntimeToolSurfaceMode = "chat" | "inspect" | "forced" | "terminal";

export type RuntimeToolSurfaceReason =
  | "scope_blocked"
  | "chat_only"
  | "workflow_terminal"
  | "workflow_forced";

export interface RuntimeToolSurface {
  mode: RuntimeToolSurfaceMode;
  action: WorkflowAction | null;
  activeTools: AuthoringToolName[];
  toolChoice: ToolStep["toolChoice"];
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

export function buildChatToolSurface(input: {
  scope: { kind: string };
  reason: RuntimeToolSurfaceReason;
}): RuntimeToolSurface {
  return {
    mode: "chat",
    action: null,
    activeTools: [],
    toolChoice: "none",
    promptSections: ["identity", "inspect", scopePromptSection(input.scope)],
    reason: input.reason,
  };
}

export function buildInspectToolSurface(input: {
  scope: { kind: string };
  profile?: AuthoringCapabilityProfile;
}): RuntimeToolSurface {
  const readScope = scopeName(input.scope);
  const includeDeclaration =
    input.profile === undefined ||
    input.profile === "author-dashboard" ||
    input.profile === "author-focused";
  return {
    mode: "inspect",
    action: null,
    activeTools: uniqueTools([
      ...getReadToolNamesForScope(readScope),
      ...(includeDeclaration ? ["declareAuthoringGoal" as const] : []),
    ]),
    toolChoice: "auto",
    promptSections: ["identity", "inspect", scopePromptSection(input.scope)],
  };
}

function workflowActionPromptSection(action: WorkflowAction): string {
  switch (action.kind) {
    case "inspect_view":
      return "inspect_view";
    case "prepare_data_context":
      return action.tool === "getSchemaByDatasource"
        ? "prepare_query_context"
        : "prepare_data_context";
    case "prepare_query_context":
      return "prepare_query_context";
    case "prepare_view_context":
      return "load_chart_skill";
    case "stage_query":
      return "stage_query";
    case "stage_view":
      return "stage_view";
    case "stage_binding":
      return "stage_binding";
    case "stage_layout":
      return "stage_layout";
    case "run_check":
      return "run_check";
    case "compose_patch":
      return "compose_patch";
    case "apply_patch":
      return "apply_patch";
    case "await_approval":
      return "approval";
    default:
      return "workflow_response";
  }
}

export function buildWorkflowToolSurface(input: {
  action: WorkflowAction;
  step: ToolStep;
  scope: { kind: string };
}): RuntimeToolSurface {
  return {
    mode: input.step.mode === "forced" ? "forced" : "terminal",
    action: input.action,
    activeTools: [...input.step.activeTools],
    toolChoice: input.step.toolChoice,
    promptSections: [
      "identity",
      workflowActionPromptSection(input.action),
      scopePromptSection(input.scope),
    ],
    reason:
      input.step.mode === "forced" ? "workflow_forced" : "workflow_terminal",
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

export function normalizeActiveAuthoringToolName(
  toolName: string,
): AuthoringToolName | null {
  return isCanonicalAuthoringToolName(toolName) ? toolName : null;
}
