import type { MainAgentMessage } from "@/ai/main-agent/contracts/agent-contract";
import type { DashboardDocument } from "@/contracts";
import { extractLatestUserText } from "@/ai/shared/messages/extract-latest-user-text";

export interface MainAgentWorkerRoute {
  worker: "dashboard" | "view";
  focusedViewId: string | null;
  reason: string;
}

const ENGLISH_GLOBAL_REQUEST_TERMS = [
  "all views",
  "entire report",
  "whole report",
  "global layout",
  "move",
  "resize",
  "position",
  "publish",
  "layout",
];

const CHINESE_GLOBAL_REQUEST_TERMS = [
  "整个看板",
  "所有图表",
  "整体布局",
  "全局布局",
  "移动",
  "放大",
  "缩小",
  "发布",
  "整个报表",
];

const GLOBAL_REQUEST_PATTERN = new RegExp(
  [...ENGLISH_GLOBAL_REQUEST_TERMS, ...CHINESE_GLOBAL_REQUEST_TERMS]
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "i",
);

export function resolveMainAgentWorkerRoute(input: {
  dashboard: DashboardDocument;
  messages: MainAgentMessage[];
  focusedViewId?: string | null;
}): MainAgentWorkerRoute {
  const latestUserText = extractLatestUserText(input.messages) ?? "";
  const trimmedFocus = input.focusedViewId?.trim() || null;

  if (trimmedFocus) {
    if (GLOBAL_REQUEST_PATTERN.test(latestUserText)) {
      return {
        worker: "dashboard",
        focusedViewId: null,
        reason: "Focused turn escalated to dashboard worker for global/layout handling.",
      };
    }

    return {
      worker: "view",
      focusedViewId: trimmedFocus,
      reason: "Focused turn routed to the matching view worker.",
    };
  }

  const exactMatches = input.dashboard.dashboard_spec.views.filter((view) =>
    latestUserText.includes(view.title),
  );
  if (exactMatches.length === 1 && !GLOBAL_REQUEST_PATTERN.test(latestUserText)) {
    return {
      worker: "view",
      focusedViewId: exactMatches[0].id,
      reason: "Non-focused turn matched exactly one view title and was routed to that view worker.",
    };
  }

  return {
    worker: "dashboard",
    focusedViewId: null,
    reason: "Defaulting to dashboard worker.",
  };
}
