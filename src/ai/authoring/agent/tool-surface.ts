import type { AuthoringToolName } from "@/ai/authoring/contracts/runtime";
import type { AuthoringToolSet } from "@/ai/authoring/tools/definition";
import {
  getReadToolNamesForScope,
  isCanonicalAuthoringToolName,
} from "@/ai/authoring/tools/registry";
import type {
  ToolStep,
  WorkflowAction,
} from "@/ai/authoring/workflow/types";

export type RuntimeToolSurfaceMode = "inspect" | ToolStep["mode"];

export interface RuntimeToolSurface {
  mode: RuntimeToolSurfaceMode;
  action: WorkflowAction | null;
  activeTools: AuthoringToolName[];
  toolChoice: ToolStep["toolChoice"];
  promptSections: string[];
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

export function buildInspectToolSurface(input: {
  scope: { kind: string };
}): RuntimeToolSurface {
  const readScope = scopeName(input.scope);
  return {
    mode: "inspect",
    action: null,
    activeTools: uniqueTools([
      ...getReadToolNamesForScope(readScope),
      "declareAuthoringGoal",
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
    mode: input.step.mode,
    action: input.action,
    activeTools: [...input.step.activeTools],
    toolChoice: input.step.toolChoice,
    promptSections: [
      "identity",
      workflowActionPromptSection(input.action),
      scopePromptSection(input.scope),
    ],
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
