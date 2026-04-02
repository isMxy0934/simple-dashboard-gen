import {
  createUIMessageStream,
  type UIMessageStreamOnFinishCallback,
  type UIMessageStreamOnStepFinishCallback,
} from "ai";
import type { DashboardDocument, DatasourceContext } from "@/contracts";
import type {
  DashboardAgentMessage,
  ViewCheckSnapshot,
} from "@/agent/dashboard-agent/contracts/agent-contract";
import {
  summarizeDashboardAgentRouteDecision,
  type DashboardAgentRouteDecision,
} from "@/agent/dashboard-agent/contracts/route";
import { buildViewListSummary } from "@/agent/dashboard-agent/context";
import {
  writeDashboardAgentTrace,
  type DashboardAgentDependencies,
} from "@/agent/dashboard-agent/runtime/dependencies";
import { createDashboardAgentStream } from "@/agent/dashboard-agent/runtime/dashboard-agent-loop";
import {
  buildDashboardConversationReply,
  createDashboardAgentWorkflow,
} from "@/agent/dashboard-agent/workflow";

export async function createDashboardAgentRuntimeStream(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasourceContext?: DatasourceContext | null;
  messages: DashboardAgentMessage[];
  checks?: ViewCheckSnapshot[] | null;
  sessionId?: string;
  abortSignal?: AbortSignal;
  onStepFinish?: UIMessageStreamOnStepFinishCallback<DashboardAgentMessage>;
  onFinish?: UIMessageStreamOnFinishCallback<DashboardAgentMessage>;
  dependencies?: DashboardAgentDependencies;
}) {
  const workflow = createDashboardAgentWorkflow({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasourceContext: input.datasourceContext,
    messages: input.messages,
    checks: input.checks,
    dependencies: input.dependencies,
  });

  await writeDashboardAgentTrace(
    input.dependencies,
    "dashboard-runtime",
    "route-decision",
    {
      sessionId: input.sessionId,
      route: workflow.routeDecision.route,
      summary: summarizeDashboardAgentRouteDecision(workflow.routeDecision),
      signals: workflow.routeDecision.signals,
      active_stage: workflow.summary.active_stage,
      active_tools: workflow.activeTools,
    },
  );

  if (workflow.routeDecision.route !== "authoring") {
    return createConversationResponseStream({
      ...input,
      workflow,
      routeDecision: workflow.routeDecision,
    });
  }

  const agentStream = await createDashboardAgentStream({
    workflow,
    messages: input.messages,
    abortSignal: input.abortSignal,
    dependencies: input.dependencies,
    sessionId: input.sessionId,
  });

  const viewSummary = buildViewListSummary({
    document: input.dashboard,
    dashboardId: input.dashboardId,
    checks: input.checks,
  });

  return createUIMessageStream({
    originalMessages: input.messages,
    onStepFinish: input.onStepFinish,
    onFinish: input.onFinish,
    execute: ({ writer }) => {
      writer.write({
        type: "data-dashboard_agent_route",
        data: workflow.routeDecision,
      });
      writer.write({
        type: "data-dashboard_agent_workflow",
        data: workflow.summary,
      });
      writer.write({
        type: "data-view_list_summary",
        data: viewSummary,
      });
      if (input.checks?.length) {
        writer.write({
          type: "data-view_check_updates",
          data: input.checks,
        });
      }
      writer.merge(agentStream);
    },
  });
}

function createConversationResponseStream(input: {
  dashboard: DashboardDocument;
  messages: DashboardAgentMessage[];
  workflow: ReturnType<typeof createDashboardAgentWorkflow>;
  routeDecision: DashboardAgentRouteDecision;
  sessionId?: string;
  dependencies?: DashboardAgentDependencies;
  onFinish?: UIMessageStreamOnFinishCallback<DashboardAgentMessage>;
}) {
  const textId = `conversation-${crypto.randomUUID()}`;
  const reply = buildDashboardConversationReply(input);

  void writeDashboardAgentTrace(
    input.dependencies,
    "dashboard-runtime",
    "conversation-reply",
    {
      sessionId: input.sessionId,
      char_length: reply.length,
      preview: reply.slice(0, 800),
    },
  );

  return createUIMessageStream({
    originalMessages: input.messages,
    onFinish: input.onFinish,
    execute: ({ writer }) => {
      writer.write({
        type: "data-dashboard_agent_route",
        data: input.routeDecision,
      });
      writer.write({
        type: "data-dashboard_agent_workflow",
        data: input.workflow.summary,
      });
      writer.write({
        type: "text-start",
        id: textId,
      });
      writer.write({
        type: "text-delta",
        id: textId,
        delta: reply,
      });
      writer.write({
        type: "text-end",
        id: textId,
      });
    },
  });
}
