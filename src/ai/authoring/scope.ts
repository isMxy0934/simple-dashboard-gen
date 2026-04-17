import type { AuthoringMessage, AuthoringSkillSummary, AuthoringToolName } from "@/ai/authoring/types";
import type { ViewListItem, DatasourceListItemSummary } from "@/ai/authoring/contracts/tool-io";
import type { AuthoringScopeDecision } from "@/ai/authoring/types";
import { extractLatestUserText } from "@/ai/authoring/shared/extract-latest-user-text";
import {
  findLatestDraftOutput,
  hasPendingApprovalResponse,
  hasPendingToolApproval,
} from "@/ai/authoring/messages/inspection";

export interface AuthoringScopeInput {
  dashboard: {
    id: string | null;
    name: string;
    views: Array<Pick<ViewListItem, "id" | "title" | "renderer_kind" | "check_status">>;
    datasources: DatasourceListItemSummary[];
    checksSummary: { ok: number; warning: number; error: number };
  };
  messages: AuthoringMessage[];
  focusedViewId: string | null;
  stepHistoryInTurn: Array<{ toolName: string; outcome: "ok" | "error" }>;
  skills: AuthoringSkillSummary[];
}

export const CAPABILITY_QUESTION_REGEX =
  /(what can you do|what do you do|how can you help|help me with|你可以做什么|你能做什么|你会做什么|你能帮我什么|你可以帮我什么)/i;

export const EXPLORATORY_QUESTION_REGEX =
  /(inspect|analyze|explore|understand|看看|查看|分析|解释|有哪些|什么数据|哪些字段|schema|结构|状态|现状|当前情况|why|为什么|怎么回事)/i;

const APPLY_DIRECTIVE_REGEX =
  /\b(apply|approve|confirm|go ahead|继续应用|应用|批准|确认|执行)\b/i;

const CANCEL_DIRECTIVE_REGEX =
  /\b(cancel|discard|撤回|取消|不要应用|别应用)\b/i;

export const GLOBAL_INTENT_KEYWORDS = [
  "all views",
  "entire report",
  "whole report",
  "global layout",
  "move",
  "resize",
  "position",
  "publish",
  "layout",
  "整个看板",
  "所有图表",
  "整体布局",
  "全局布局",
  "移动",
  "放大",
  "缩小",
  "发布",
  "整个报表",
  "新增视图",
  "删除视图",
  "对齐",
];

const GLOBAL_INTENT_REGEX = new RegExp(
  GLOBAL_INTENT_KEYWORDS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i",
);

export const READ_DASHBOARD_TOOLS = [
  "getViews",
  "getView",
  "getQuery",
  "getBinding",
  "getDatasources",
  "getSchemaByDatasource",
  "runCheck",
  "loadSkill",
  "loadSkillReference",
] satisfies AuthoringToolName[];

export const READ_FOCUSED_TOOLS = [
  "getView",
  "getQuery",
  "getBinding",
  "getDatasources",
  "getSchemaByDatasource",
  "runCheck",
  "loadSkill",
  "loadSkillReference",
] satisfies AuthoringToolName[];

export const WRITE_DASHBOARD_TOOLS = [
  "upsertView",
  "upsertQuery",
  "upsertBinding",
  "deleteView",
  "deleteQuery",
  "deleteBinding",
] satisfies AuthoringToolName[];

export const WRITE_FOCUSED_TOOLS = [
  "upsertView",
  "upsertQuery",
  "upsertBinding",
  "deleteQuery",
  "deleteBinding",
] satisfies AuthoringToolName[];

export const PROPOSE_TOOLS = ["composePatch"] satisfies AuthoringToolName[];
export const APPLY_TOOLS = ["applyPatch"] satisfies AuthoringToolName[];
export const ESCAPE_TOOLS = ["focusedTask"] satisfies AuthoringToolName[];

function unionTools(...groups: readonly AuthoringToolName[][]): AuthoringToolName[] {
  return [...new Set(groups.flatMap((group) => group))];
}

function resolveRelevantSkillIds(
  latestUserText: string,
  skills: AuthoringSkillSummary[],
): string[] {
  const lowered = latestUserText.toLowerCase();
  return skills
    .filter((skill) =>
      lowered.includes(skill.id.toLowerCase()) || lowered.includes(skill.name.toLowerCase()),
    )
    .map((skill) => skill.id);
}

function isExplicitApprovalDirective(text: string): boolean {
  return APPLY_DIRECTIVE_REGEX.test(text) || CANCEL_DIRECTIVE_REGEX.test(text);
}

function findAutoFocusedViewId(input: AuthoringScopeInput, latestUserText: string): string | null {
  if (!latestUserText.trim() || GLOBAL_INTENT_REGEX.test(latestUserText)) {
    return null;
  }

  const matches = input.dashboard.views.filter((view) => latestUserText.includes(view.title));
  return matches.length === 1 ? matches[0].id : null;
}

function getDefaultSections(mode: AuthoringScopeDecision["mode"]): string[] {
  switch (mode) {
    case "chat":
      return ["identity", "chat"];
    case "explore":
      return ["identity", "explore"];
    case "author-first-view":
      return ["identity", "authoring", "first-view"];
    case "author-focused":
      return ["identity", "authoring", "focused"];
    case "approval":
      return ["identity", "approval"];
    default:
      return ["identity", "authoring", "dashboard"];
  }
}

export function computeAuthoringScope(input: AuthoringScopeInput): AuthoringScopeDecision {
  const latestUserText = extractLatestUserText(input.messages) ?? "";
  const relevantSkillIds = resolveRelevantSkillIds(latestUserText, input.skills);
  const explicitFocus =
    input.focusedViewId &&
    input.dashboard.views.some((view) => view.id === input.focusedViewId)
      ? input.focusedViewId
      : null;
  const autoFocusedViewId = explicitFocus ? null : findAutoFocusedViewId(input, latestUserText);
  const resolvedFocusedViewId = explicitFocus ?? autoFocusedViewId;

  if (input.stepHistoryInTurn.some((step) => step.toolName === "applyPatch" && step.outcome === "ok")) {
    const scope =
      resolvedFocusedViewId
        ? ({ kind: "focused", viewId: resolvedFocusedViewId } as const)
        : ({ kind: "dashboard" } as const);
    const mode = resolvedFocusedViewId ? "author-focused" : "author-dashboard";
    return {
      mode,
      scope,
      activeTools: [],
      toolChoice: "none",
      systemPromptSections: getDefaultSections(mode),
      contextBlockVariant: resolvedFocusedViewId ? "focused" : "dashboard",
      relevantSkillIds,
      stopReason: "approval-applied",
    };
  }

  if (hasPendingApprovalResponse(input.messages)) {
    return {
      mode: "approval",
      scope: { kind: "dashboard" },
      activeTools: [...APPLY_TOOLS],
      toolChoice: "auto",
      systemPromptSections: getDefaultSections("approval"),
      contextBlockVariant: "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  const latestDraft = findLatestDraftOutput(input.messages);
  if (latestDraft && hasPendingToolApproval(input.messages)) {
    if (isExplicitApprovalDirective(latestUserText)) {
      return {
        mode: "approval",
        scope: { kind: "dashboard" },
        activeTools: [...APPLY_TOOLS],
        toolChoice: "auto",
        systemPromptSections: getDefaultSections("approval"),
        contextBlockVariant: "dashboard",
        relevantSkillIds,
        stopReason: null,
      };
    }

    return {
      mode: "chat",
      scope: { kind: "dashboard" },
      activeTools: [],
      toolChoice: "none",
      systemPromptSections: getDefaultSections("chat"),
      contextBlockVariant: "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  if (CAPABILITY_QUESTION_REGEX.test(latestUserText)) {
    return {
      mode: "chat",
      scope: { kind: "dashboard" },
      activeTools: [],
      toolChoice: "none",
      systemPromptSections: getDefaultSections("chat"),
      contextBlockVariant: "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  if (EXPLORATORY_QUESTION_REGEX.test(latestUserText) && !GLOBAL_INTENT_REGEX.test(latestUserText)) {
    const scope =
      resolvedFocusedViewId
        ? ({ kind: "focused", viewId: resolvedFocusedViewId } as const)
        : ({ kind: "dashboard" } as const);
    const activeTools = resolvedFocusedViewId ? READ_FOCUSED_TOOLS : READ_DASHBOARD_TOOLS;
    return {
      mode: "explore",
      scope,
      activeTools: [...activeTools],
      toolChoice: "auto",
      systemPromptSections: getDefaultSections("explore"),
      contextBlockVariant: resolvedFocusedViewId ? "focused" : "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  if (input.dashboard.views.length === 0) {
    return {
      mode: "author-first-view",
      scope: { kind: "empty" },
      activeTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS, PROPOSE_TOOLS),
      toolChoice: "auto",
      systemPromptSections: getDefaultSections("author-first-view"),
      contextBlockVariant: "empty",
      relevantSkillIds,
      stopReason: null,
    };
  }

  if (resolvedFocusedViewId && !GLOBAL_INTENT_REGEX.test(latestUserText)) {
    return {
      mode: "author-focused",
      scope: { kind: "focused", viewId: resolvedFocusedViewId },
      activeTools: unionTools(READ_FOCUSED_TOOLS, WRITE_FOCUSED_TOOLS, PROPOSE_TOOLS),
      toolChoice: "auto",
      systemPromptSections: getDefaultSections("author-focused"),
      contextBlockVariant: "focused",
      relevantSkillIds,
      stopReason: null,
    };
  }

  return {
    mode: "author-dashboard",
    scope: { kind: "dashboard" },
    activeTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS, PROPOSE_TOOLS, ESCAPE_TOOLS),
    toolChoice: "auto",
    systemPromptSections: getDefaultSections("author-dashboard"),
    contextBlockVariant: "dashboard",
    relevantSkillIds,
    stopReason: null,
  };
}
