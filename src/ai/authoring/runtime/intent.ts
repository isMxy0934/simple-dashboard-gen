import type { AuthoringIntent } from "@/ai/authoring/contracts/tool-io";

const QUESTION_PATTERN =
  /[?？]|\b(what|why|how|which|when|where|explain|describe|show me|tell me)\b/i;
const QUESTION_PATTERN_ZH = /(什么|为何|为什么|怎么|如何|哪个|哪些|解释|说明|查看|看看|分析一下)/;

const MUTATION_PATTERN =
  /\b(add|create|make|build|insert|update|change|modify|edit|delete|remove|resize|move|layout|publish|save|retry|rerun|continue|fix|try again)\b/i;
const MUTATION_PATTERN_ZH =
  /(新增|添加|创建|生成|制作|构建|插入|更新|修改|调整|编辑|删除|移除|去掉|布局|移动|拖动|缩放|保存|发布|重新执行|执行一下|执行吧|重试|再试|继续|修复|重跑)/;

const VISUALIZATION_PATTERN =
  /\b(chart|graph|trend|kpi|report|dashboard|card|view|line|bar|pie|table|ranking|compare|comparison|breakdown)\b/i;
const VISUALIZATION_PATTERN_ZH =
  /(图表|图|趋势|折线|柱状|饼图|排行|排名|对比|分布|拆分|看板|仪表盘|报表|卡片|视图|指标|大屏)/;

const SOFT_CREATE_PATTERN_ZH = /(看看|看下|做个|做一张|来个|出个|出一张|画个|画一张)/;

function looksLikeVisualizationRequest(text: string): boolean {
  return (
    VISUALIZATION_PATTERN.test(text) ||
    VISUALIZATION_PATTERN_ZH.test(text)
  );
}

function looksLikeSoftCreateRequest(text: string): boolean {
  return SOFT_CREATE_PATTERN_ZH.test(text) && looksLikeVisualizationRequest(text);
}

export function inferAuthoringIntentFromText(text: string): AuthoringIntent {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return "explore";
  }

  const asksQuestion =
    QUESTION_PATTERN.test(normalized) ||
    QUESTION_PATTERN_ZH.test(normalized);
  const mutatesDashboard =
    MUTATION_PATTERN.test(normalized) ||
    MUTATION_PATTERN_ZH.test(normalized) ||
    looksLikeSoftCreateRequest(normalized);

  return mutatesDashboard || !asksQuestion ? "author" : "explore";
}

export function resolveAuthoringIntentFromText(
  latestUserText: string,
  explicitIntent?: AuthoringIntent | null,
): AuthoringIntent {
  if (
    explicitIntent === "apply" ||
    explicitIntent === "cancel" ||
    explicitIntent === "ask-capability" ||
    explicitIntent === "author"
  ) {
    return explicitIntent;
  }

  const inferred = inferAuthoringIntentFromText(latestUserText);
  if (explicitIntent === "explore") {
    return inferred === "author" ? "author" : "explore";
  }
  return "explore";
}
