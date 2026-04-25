import type {
  AuthoringMode,
  AuthoringScopeDecision,
  AuthoringSkillSummary,
  AuthoringToolName,
} from "@/ai/authoring/types";
import type {
  AuthoringIntent,
  ViewListItem,
  DatasourceListItemSummary,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringConversationSignals } from "@/ai/authoring/messages/conversation-signals";
import { hasConfirmedDataContext } from "@/ai/authoring/data-context-gate";
import type {
  AuthoringRouteAdvice,
  AuthoringTaskStateSnapshot,
} from "@/ai/authoring/contracts/session-state";

/** Consecutive tool errors at the trailing end of this tool's history before it is dropped. */
export const TOOL_FAILURE_THRESHOLD = 3;

export interface AuthoringScopeInput {
  dashboard: {
    id: string | null;
    name: string;
    views: Array<Pick<ViewListItem, "id" | "title" | "renderer_kind" | "check_status">>;
    datasources: DatasourceListItemSummary[];
    checksSummary: { ok: number; warning: number; error: number };
  };
  conversation: AuthoringConversationSignals;
  focusedViewId: string | null;
  stepHistoryInTurn: Array<{ toolName: string; outcome: "ok" | "error" }>;
  skills: AuthoringSkillSummary[];
  /**
   * Optional explicit intent provided by the caller (e.g. the chat route
   * forwarding a UI-declared intent). When provided it short-circuits the
   * keyword-based detection below. Keyword detection is still used for plain
   * free-text turns.
   */
  intentSignal?: AuthoringIntent | null;
  routeAdvice?: AuthoringRouteAdvice | null;
  taskState?: AuthoringTaskStateSnapshot | null;
  /**
   * Mode locked at the start of the user turn. When set, recomputed scope
   * decisions are clamped so mode / tools / prompt sections stay aligned with
   * this mode unless the turn legitimately enters approval or stop.
   */
  lockedMode?: AuthoringMode | null;
}

export type { AuthoringIntent };

/** Keyword lists for `apply` / `cancel` only; see `resolveAuthoringIntent`. */
const INTENT_CATALOG: Record<AuthoringIntent, string[]> = {
  apply: [
    "apply",
    "approve",
    "confirm",
    "go ahead",
    "do it now",
    "ship it",
    "继续应用",
    "应用",
    "批准",
    "确认",
    "执行",
    "上线",
    "发布它",
  ],
  cancel: [
    "cancel",
    "discard",
    "drop it",
    "never mind",
    "撤回",
    "取消",
    "不要应用",
    "别应用",
    "算了",
  ],
  // Not used by keyword fallback — use UI `intent: "ask-capability"`.
  "ask-capability": [
    "what can you do",
    "what do you do",
    "how can you help",
    "help me with",
    "你可以做什么",
    "你能做什么",
    "你会做什么",
    "你能帮我什么",
    "你可以帮我什么",
  ],
  // Not used by keyword fallback — use UI `intent: "explore"`.
  explore: [
    "inspect",
    "analyze",
    "explore",
    "understand",
    "look into",
    "check current",
    "看看",
    "查看",
    "分析",
    "解释",
    "有哪些",
    "什么数据",
    "哪些字段",
    "schema",
    "结构",
    "状态",
    "现状",
    "当前情况",
    "为什么",
    "怎么回事",
  ],
  author: [],
};

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

function matchesIntent(text: string, terms: string[]): boolean {
  const lowered = text.toLowerCase();
  return terms.some((term) => lowered.includes(term.toLowerCase()));
}

/**
 * Resolves intent for routing. Keyword fallback is intentionally narrow: only
 * `apply` / `cancel` are inferred from free text. `explore`, `ask-capability`,
 * and authoring vs chat must use `explicitIntent` from the UI when needed.
 */
export function resolveAuthoringIntent(
  latestUserText: string,
  explicitIntent?: AuthoringIntent | null,
): AuthoringIntent {
  if (explicitIntent) {
    return explicitIntent;
  }

  if (matchesIntent(latestUserText, INTENT_CATALOG.apply)) {
    return "apply";
  }
  if (matchesIntent(latestUserText, INTENT_CATALOG.cancel)) {
    return "cancel";
  }
  return "author";
}

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

export const PLAN_TOOLS = [
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

export const WRITE_DASHBOARD_TOOLS = [
  "upsertView",
  "upsertQuery",
  "upsertBinding",
  "deleteView",
  "deleteQuery",
  "deleteBinding",
] satisfies AuthoringToolName[];

/**
 * Write tools allowed in focused-view mode.
 *
 * Note the intentional asymmetries vs `WRITE_DASHBOARD_TOOLS`:
 *
 *  - `upsertView` is included but the tool impl (`buildUpsertViewTool`) force-
 *    overrides `view_id` with the focused view id and uses
 *    `assertNoFocusedLayoutMutation` to reject layout edits. In focused mode
 *    it can only mutate the currently focused view.
 *  - `deleteView` is intentionally excluded: deleting the focused view would
 *    invalidate the focused scope itself, so dashboard-level edits of that
 *    shape must be done in dashboard mode.
 *  - `upsertQuery` / `upsertBinding` / `deleteQuery` / `deleteBinding` are
 *    gated by `assertFocusedViewAccess` inside each tool so cross-view writes
 *    throw.
 *
 * Keep this list consistent with the focused guards in `tools/focused-guards.ts`.
 */
export const WRITE_FOCUSED_TOOLS = [
  "upsertView",
  "upsertQuery",
  "upsertBinding",
  "deleteQuery",
  "deleteBinding",
] satisfies AuthoringToolName[];

export const PROPOSE_TOOLS = ["composePatch", "applyPatch"] satisfies AuthoringToolName[];
export const APPLY_TOOLS = ["applyPatch"] satisfies AuthoringToolName[];

function unionTools(...groups: readonly AuthoringToolName[][]): AuthoringToolName[] {
  return [...new Set(groups.flatMap((group) => group))];
}

/**
 * Pick skills whose triggers/id/name match the latest user message.
 * Matching order (first wins per skill):
 *   1. any of `skill.triggers` appears in the message (case-insensitive)
 *   2. the skill id appears in the message
 *   3. the skill name appears in the message
 *
 * Returning an empty list means "no confident match" and downstream callers
 * (e.g. `buildSkillMetadataSummary`) fall back to exposing all skills.
 */
function resolveRelevantSkillIds(
  latestUserText: string,
  skills: AuthoringSkillSummary[],
  routeAdvice?: AuthoringRouteAdvice | null,
): string[] {
  const lowered = latestUserText.toLowerCase();
  const matched = lowered.trim()
    ? skills
    .filter((skill) => {
      const triggers = skill.triggers ?? [];
      if (triggers.some((trigger) => lowered.includes(trigger.toLowerCase()))) {
        return true;
      }
      if (lowered.includes(skill.id.toLowerCase())) {
        return true;
      }
      if (lowered.includes(skill.name.toLowerCase())) {
        return true;
      }
      return false;
    })
        .map((skill) => skill.id)
    : [];
  const available = new Set(skills.map((skill) => skill.id));
  const recommended = (routeAdvice?.recommendedSkillIds ?? []).filter((id) =>
    available.has(id),
  );
  return [...new Set([...matched, ...recommended])];
}

function getDefaultSections(mode: AuthoringScopeDecision["mode"]): string[] {
  switch (mode) {
    case "chat":
      return ["identity", "chat"];
    case "plan":
      return ["identity", "plan"];
    case "explore":
      return ["identity", "explore"];
    case "author-focused":
      return ["identity", "authoring", "focused"];
    case "approval":
      return ["identity", "approval"];
    default:
      return ["identity", "authoring", "dashboard"];
  }
}

function streakTrailingFailureCount(
  history: Array<{ toolName: string; outcome: "ok" | "error" }>,
  toolName: string,
): number {
  const entries = history.filter((h) => h.toolName === toolName);
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].outcome === "error") {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function filterToolFailures(
  activeTools: AuthoringToolName[],
  history: Array<{ toolName: string; outcome: "ok" | "error" }>,
): AuthoringToolName[] {
  return activeTools.filter((name) => {
    const streak = streakTrailingFailureCount(history, name);
    return streak < TOOL_FAILURE_THRESHOLD;
  });
}

function hasExplicitDestructiveIntent(text: string): boolean {
  return /delete|remove|drop|删除|移除|删掉|清空|丢弃/i.test(text);
}

function filterUnsafeWriteTools(
  activeTools: AuthoringToolName[],
  latestUserText: string,
): AuthoringToolName[] {
  if (hasExplicitDestructiveIntent(latestUserText)) {
    return activeTools;
  }
  return activeTools.filter(
    (toolName) =>
      toolName !== "deleteView" &&
      toolName !== "deleteQuery" &&
      toolName !== "deleteBinding",
  );
}

/**
 * Toolkit for a locked mode + scope. If `author-focused` is requested but
 * scope is not focused, falls back to dashboard authoring tools.
 */
function toolkitForLockedMode(
  lockedMode: AuthoringMode,
  scope: AuthoringScopeDecision["scope"],
): Pick<
  AuthoringScopeDecision,
  "mode" | "activeTools" | "toolChoice" | "systemPromptSections"
> {
  switch (lockedMode) {
    case "chat":
      return {
        mode: "chat",
        activeTools: [],
        toolChoice: "none",
        systemPromptSections: getDefaultSections("chat"),
      };
    case "explore": {
      const readTools =
        scope.kind === "focused" ? READ_FOCUSED_TOOLS : READ_DASHBOARD_TOOLS;
      return {
        mode: "explore",
        activeTools: [...readTools],
        toolChoice: "auto",
        systemPromptSections: getDefaultSections("explore"),
      };
    }
    case "plan":
      return {
        mode: "plan",
        activeTools: [...PLAN_TOOLS],
        toolChoice: "auto",
        systemPromptSections: getDefaultSections("plan"),
      };
    case "approval":
      return {
        mode: "approval",
        activeTools: [...APPLY_TOOLS],
        toolChoice: "auto",
        systemPromptSections: getDefaultSections("approval"),
      };
    case "author-focused":
      if (scope.kind === "focused") {
        return {
          mode: "author-focused",
          activeTools: unionTools(READ_FOCUSED_TOOLS, WRITE_FOCUSED_TOOLS, PROPOSE_TOOLS),
          toolChoice: "auto",
          systemPromptSections: getDefaultSections("author-focused"),
        };
      }
      return {
        mode: "author-dashboard",
        activeTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS, PROPOSE_TOOLS),
        toolChoice: "auto",
        systemPromptSections: getDefaultSections("author-dashboard"),
      };
    case "author-dashboard":
      return {
        mode: "author-dashboard",
        activeTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS, PROPOSE_TOOLS),
        toolChoice: "auto",
        systemPromptSections: getDefaultSections("author-dashboard"),
      };
    default:
      return {
        mode: "author-dashboard",
        activeTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS, PROPOSE_TOOLS),
        toolChoice: "auto",
        systemPromptSections: getDefaultSections("author-dashboard"),
      };
  }
}

function clampToLockedMode(
  decision: AuthoringScopeDecision,
  lockedMode: AuthoringMode | null | undefined,
): AuthoringScopeDecision {
  if (!lockedMode) {
    return decision;
  }
  if (decision.mode === "approval" || decision.stopReason === "approval-applied") {
    return decision;
  }
  if (decision.mode === "chat") {
    return decision;
  }
  if (decision.mode === lockedMode) {
    return decision;
  }
  const toolkit = toolkitForLockedMode(lockedMode, decision.scope);
  return {
    ...decision,
    mode: toolkit.mode,
    activeTools: toolkit.activeTools,
    toolChoice: toolkit.toolChoice,
    systemPromptSections: toolkit.systemPromptSections,
  };
}

function computeAuthoringScopeCore(input: AuthoringScopeInput): AuthoringScopeDecision {
  const latestUserText = input.conversation.latestUserText ?? "";
  const intent = resolveAuthoringIntent(latestUserText, input.intentSignal ?? null);
  const relevantSkillIds = resolveRelevantSkillIds(
    latestUserText,
    input.skills,
    input.routeAdvice,
  );
  const explicitFocus =
    input.focusedViewId &&
    input.dashboard.views.some((view) => view.id === input.focusedViewId)
      ? input.focusedViewId
      : null;
  const resolvedFocusedViewId = explicitFocus;
  const hasExplicitDataContext = hasConfirmedDataContext({
    latestUserText,
    datasources: input.dashboard.datasources,
  }) || input.routeAdvice?.dataContextStatus === "confirmed" ||
    Boolean(input.taskState?.selectedDataContext);
  const hasAvailableDataContext =
    hasExplicitDataContext ||
    input.dashboard.datasources.length > 0 ||
    input.dashboard.views.length > 0;
  const hasSpecificOutputGoal = hasConcreteOutputGoal(latestUserText);
  const canDraftFromConfirmation =
    looksLikeAffirmativeFollowup(latestUserText) &&
    (hasAvailableDataContext ||
      input.taskState?.phase === "awaiting_data_confirmation");
  const hasConfirmedAuthoringContext =
    input.dashboard.views.length > 0 ||
    hasExplicitDataContext ||
    canDraftFromConfirmation;
  const missingDataContextForDataDraft =
    input.routeAdvice?.dataContextStatus === "missing" &&
    !hasExplicitDataContext &&
    hasSpecificOutputGoal &&
    !canDraftFromConfirmation &&
    !GLOBAL_INTENT_REGEX.test(latestUserText);
  const shouldPlan =
    intent === "author" &&
    (input.routeAdvice?.route === "plan" ||
      input.routeAdvice?.shouldAskBlocker ||
      missingDataContextForDataDraft ||
      !hasConfirmedAuthoringContext ||
      (!hasSpecificOutputGoal && !canDraftFromConfirmation));

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

  if (input.conversation.approvalState === "approved") {
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

  const latestDraft = input.conversation.latestDraftOutput;
  if (latestDraft && input.conversation.approvalState === "none") {
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

  if (latestDraft && input.conversation.approvalState === "requested") {
    if (intent === "apply") {
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

  if (intent === "ask-capability") {
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

  const advisedRoute = input.routeAdvice?.route ?? null;

  if (
    (intent === "explore" || advisedRoute === "explore") &&
    !GLOBAL_INTENT_REGEX.test(latestUserText)
  ) {
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

  if (advisedRoute === "chat" && intent !== "apply" && intent !== "cancel") {
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

  if (shouldPlan) {
    return {
      mode: "plan",
      scope: { kind: "dashboard" },
      activeTools: [...PLAN_TOOLS],
      toolChoice: "auto",
      systemPromptSections: getDefaultSections("plan"),
      contextBlockVariant: "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  if (
    (advisedRoute === "author-focused" || resolvedFocusedViewId) &&
    resolvedFocusedViewId &&
    !GLOBAL_INTENT_REGEX.test(latestUserText)
  ) {
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
    activeTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS, PROPOSE_TOOLS),
    toolChoice: "auto",
    systemPromptSections: getDefaultSections("author-dashboard"),
    contextBlockVariant: "dashboard",
    relevantSkillIds,
    stopReason: null,
  };
}

const CONCRETE_OUTPUT_TERMS = [
  "折线图",
  "柱状图",
  "饼图",
  "表格",
  "指标",
  "指标卡",
  "卡片",
  "日报",
  "周报",
  "月报",
  "季报",
  "年报",
  "明细",
  "趋势",
  "收入",
  "营收",
  "销售",
  "销售额",
  "销售报表",
  "销售看板",
  "订单",
  "客单价",
  "渠道",
  "top",
  "topn",
  "排名",
  "占比",
  "转化",
  "留存",
  "漏斗",
  "select",
  "from",
  "count(",
  "sum(",
  "sql",
  "kpi",
  "趋势图",
  "line chart",
  "bar chart",
  "pie chart",
  "table",
  "chart",
  "sales dashboard",
  "view",
  "图表",
  "新增视图",
  "添加一个",
  "创建",
  "生成",
  "add a",
  "create a chart",
  "update",
  "modify",
  "优化布局",
  "绑定",
  "query",
];

const AFFIRMATIVE_FOLLOWUP_TERMS = [
  "好",
  "好的",
  "可以",
  "可以的",
  "行",
  "对",
  "是的",
  "嗯",
  "确认",
  "就这样",
  "按这个来",
  "go ahead",
  "yes",
  "ok",
  "okay",
];

const DRAFT_NOW_TERMS = [
  "先创建",
  "先生成",
  "先做出来",
  "直接创建",
  "直接生成",
  "直接做",
  "创建出来",
  "创建呀",
  "创建",
  "生成",
  "生成吧",
  "做吧",
  "做出来",
  "开始",
  "开始做",
  "继续创建",
  "继续做",
  "落地",
];

function hasConcreteOutputGoal(text: string): boolean {
  const lowered = text.trim().toLowerCase();
  if (!lowered) {
    return false;
  }
  return CONCRETE_OUTPUT_TERMS.some((term) =>
    lowered.includes(term.toLowerCase()),
  );
}

function normalizeShortReply(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s,.!?，。！？、；;:：]/g, "");
}

function looksLikeAffirmativeFollowup(text: string): boolean {
  const normalized = normalizeShortReply(text);
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("不要") ||
    normalized.includes("别") ||
    normalized.includes("不行") ||
    normalized.includes("不可以")
  ) {
    return false;
  }
  if (
    DRAFT_NOW_TERMS.some((term) =>
      normalized.includes(normalizeShortReply(term)),
    )
  ) {
    return true;
  }
  if (normalized.includes("不")) {
    return false;
  }
  if (
    AFFIRMATIVE_FOLLOWUP_TERMS.some(
      (term) => normalized === normalizeShortReply(term),
    )
  ) {
    return true;
  }
  return false;
}

export function computeAuthoringScope(input: AuthoringScopeInput): AuthoringScopeDecision {
  const raw = computeAuthoringScopeCore(input);
  const clamped = clampToLockedMode(raw, input.lockedMode);
  return {
    ...clamped,
    activeTools: filterUnsafeWriteTools(
      filterToolFailures(clamped.activeTools, input.stepHistoryInTurn),
      input.conversation.latestUserText ?? "",
    ),
  };
}
