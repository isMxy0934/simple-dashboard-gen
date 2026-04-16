import {
  createUIMessageStream,
  type UIMessageStreamOnFinishCallback,
  type UIMessageStreamOnStepFinishCallback,
} from "ai";
import type { DashboardDocument } from "@/contracts";
import type {
  DatasourceListItemSummary,
  MainAgentMessage,
  MainAgentSkillSummary,
  ViewCheckSnapshot,
} from "@/ai/main-agent/contracts/agent-contract";
import type { MainAgentWorkingDraftSnapshot } from "@/ai/main-agent/contracts/session-state";
import {
  summarizeMainAgentRouteDecision,
  type MainAgentRouteDecision,
} from "@/ai/main-agent/contracts/route";
import {
  writeMainAgentTrace,
  type MainAgentDependencies,
} from "@/ai/main-agent/engine/dependencies";

export async function createWorkerEngineStreamCore<TWorkflow extends {
  routeDecision: MainAgentRouteDecision;
  summary: { active_stage: string; active_tools: string[] };
  activeTools: string[];
  getDraftSnapshot: () => MainAgentWorkingDraftSnapshot | null;
}>(input: {
  workerTraceScope: string;
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: MainAgentSkillSummary[] | null;
  messages: MainAgentMessage[];
  modelMessages?: MainAgentMessage[];
  checks?: ViewCheckSnapshot[] | null;
  initialWorkingDraft?: MainAgentWorkingDraftSnapshot | null;
  sessionId?: string;
  abortSignal?: AbortSignal;
  onStepFinish?: UIMessageStreamOnStepFinishCallback<MainAgentMessage>;
  onFinish?: UIMessageStreamOnFinishCallback<MainAgentMessage>;
  dependencies?: MainAgentDependencies;
  buildWorkflow: (args: {
    dashboard: DashboardDocument;
    dashboardId?: string | null;
    focusedViewId?: string | null;
    datasources?: DatasourceListItemSummary[] | null;
    skills?: MainAgentSkillSummary[] | null;
    messages: MainAgentMessage[];
    checks?: ViewCheckSnapshot[] | null;
    initialWorkingDraft?: MainAgentWorkingDraftSnapshot | null;
    dependencies?: MainAgentDependencies;
  }) => TWorkflow;
  createAgentStream: (args: {
    workflow: TWorkflow;
    messages: MainAgentMessage[];
    originalMessages?: MainAgentMessage[];
    abortSignal?: AbortSignal;
    dependencies?: MainAgentDependencies;
    sessionId?: string;
  }) => Promise<ReadableStream>;
  buildViewSummary: (args: {
    document: DashboardDocument;
    dashboardId?: string | null;
    checks?: ViewCheckSnapshot[] | null;
    focusedViewId?: string | null;
  }) => unknown;
  buildConversationReply: (args: {
    dashboard: DashboardDocument;
    messages: MainAgentMessage[];
    routeDecision: MainAgentRouteDecision;
  }) => string;
}) {
  const workflow = input.buildWorkflow({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    focusedViewId: input.focusedViewId,
    datasources: input.datasources,
    skills: input.skills,
    messages: input.messages,
    checks: input.checks,
    initialWorkingDraft: input.initialWorkingDraft,
    dependencies: input.dependencies,
  });

  await writeMainAgentTrace(
    input.dependencies,
    input.workerTraceScope,
    "route-decision",
    {
      sessionId: input.sessionId,
      route: workflow.routeDecision.route,
      summary: summarizeMainAgentRouteDecision(workflow.routeDecision),
      signals: workflow.routeDecision.signals,
      active_stage: workflow.summary.active_stage,
      active_tools: workflow.activeTools,
    },
  );

  if (workflow.routeDecision.route !== "authoring") {
    return {
      stream: createConversationResponseStream({
        workerTraceScope: input.workerTraceScope,
        dashboard: input.dashboard,
        messages: input.messages,
        workflow,
        routeDecision: workflow.routeDecision,
        sessionId: input.sessionId,
        dependencies: input.dependencies,
        onFinish: input.onFinish,
        buildConversationReply: input.buildConversationReply,
      }),
      getDraftSnapshot: workflow.getDraftSnapshot,
    };
  }

  const agentStream = await input.createAgentStream({
    workflow,
    messages: input.modelMessages ?? input.messages,
    originalMessages: input.messages,
    abortSignal: input.abortSignal,
    dependencies: input.dependencies,
    sessionId: input.sessionId,
  });

  const viewSummary = input.buildViewSummary({
    document: input.dashboard,
    dashboardId: input.dashboardId,
    checks: input.checks,
    focusedViewId: input.focusedViewId,
  });

  return {
    stream: createUIMessageStream({
      originalMessages: input.messages,
      onStepFinish: input.onStepFinish,
      onFinish: input.onFinish,
      execute: ({ writer }) => {
        writer.write({
          type: "data-main_agent_route",
          data: workflow.routeDecision,
        });
        writer.write({
          type: "data-main_agent_workflow",
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
    }),
    getDraftSnapshot: workflow.getDraftSnapshot,
  };
}

function createConversationResponseStream<TWorkflow extends {
  summary: unknown;
}>(input: {
  workerTraceScope: string;
  dashboard: DashboardDocument;
  messages: MainAgentMessage[];
  workflow: TWorkflow;
  routeDecision: MainAgentRouteDecision;
  sessionId?: string;
  dependencies?: MainAgentDependencies;
  onFinish?: UIMessageStreamOnFinishCallback<MainAgentMessage>;
  buildConversationReply: (args: {
    dashboard: DashboardDocument;
    messages: MainAgentMessage[];
    routeDecision: MainAgentRouteDecision;
  }) => string;
}) {
  const textId = `conversation-${crypto.randomUUID()}`;
  const reply = input.buildConversationReply({
    dashboard: input.dashboard,
    messages: input.messages,
    routeDecision: input.routeDecision,
  });

  void writeMainAgentTrace(
    input.dependencies,
    input.workerTraceScope,
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
        type: "data-main_agent_route",
        data: input.routeDecision,
      });
      writer.write({
        type: "data-main_agent_workflow",
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
