import type { DashboardAgentMessage } from "@/ai/dashboard-agent/contracts/agent-contract";
import type { DashboardDocument } from "@/contracts";

export interface MainAgentWorkerRoute {
  worker: "dashboard" | "view";
  focusedViewId: string | null;
  reason: string;
}

function extractLatestUserText(messages: DashboardAgentMessage[]) {
  const reversed = [...messages].reverse();
  for (const message of reversed) {
    if (message.role !== "user") {
      continue;
    }
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }

  return "";
}

const GLOBAL_REQUEST_PATTERN =
  /(layout|move|resize|position|dashboard|all views|entire report|publish|review|global|整体|全局|布局|移动|放大|缩小|发布|所有视图|整个报表|检查整体)/i;

export function resolveMainAgentWorkerRoute(input: {
  dashboard: DashboardDocument;
  messages: DashboardAgentMessage[];
  focusedViewId?: string | null;
}): MainAgentWorkerRoute {
  const latestUserText = extractLatestUserText(input.messages);
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
