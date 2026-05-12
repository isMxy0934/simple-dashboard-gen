import type { AuthoringIntent } from "@/ai/authoring/contracts/tool-io";

export function inferAuthoringIntent(text: string): AuthoringIntent {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return "explore";
  }

  const asksQuestion =
    /[?？]/.test(normalized) ||
    /\b(what|why|how|which|when|where|explain|describe|show me|tell me)\b/i.test(normalized) ||
    /(什么|为何|为什么|怎么|如何|哪个|哪些|解释|说明|查看|看看|分析一下)/.test(normalized);
  const mutatesDashboard =
    /\b(add|create|make|build|insert|update|change|modify|edit|delete|remove|resize|move|layout|publish|save)\b/i.test(normalized) ||
    /(新增|添加|创建|生成|制作|构建|插入|更新|修改|调整|编辑|删除|移除|去掉|布局|移动|拖动|缩放|保存|发布)/.test(normalized);

  return mutatesDashboard || !asksQuestion ? "author" : "explore";
}
