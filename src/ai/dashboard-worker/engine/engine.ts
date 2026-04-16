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
import { buildViewListSummary } from "@/ai/dashboard-worker/context";
import {
  writeMainAgentTrace,
  type MainAgentDependencies,
} from "@/ai/main-agent/engine/dependencies";
import { createWorkerAgentStream } from "@/ai/dashboard-worker/engine/loop";
import {
  buildWorkerConversationReply,
  createWorkerWorkflow,
} from "@/ai/dashboard-worker/workflow";

export async function createWorkerEngineStream(input: {
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
}) {
  const workflow = createWorkerWorkflow({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    skills: input.skills,
    messages: input.messages,
    checks: input.checks,
    initialWorkingDraft: input.initialWorkingDraft,
    dependencies: input.dependencies,
  });

  await writeMainAgentTrace(
    input.dependencies,
    "dashboard-engine",
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
        ...input,
        workflow,
        routeDecision: workflow.routeDecision,
      }),
      getDraftSnapshot: workflow.getDraftSnapshot,
    };
  }

  const agentStream = await createWorkerAgentStream({
    workflow,
    messages: input.modelMessages ?? input.messages,
    originalMessages: input.messages,
    abortSignal: input.abortSignal,
    dependencies: input.dependencies,
    sessionId: input.sessionId,
  });

  const viewSummary = buildViewListSummary({
    document: input.dashboard,
    dashboardId: input.dashboardId,
    checks: input.checks,
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

function createConversationResponseStream(input: {
  dashboard: DashboardDocument;
  messages: MainAgentMessage[];
  workflow: ReturnType<typeof createWorkerWorkflow>;
  routeDecision: MainAgentRouteDecision;
  sessionId?: string;
  dependencies?: MainAgentDependencies;
  onFinish?: UIMessageStreamOnFinishCallback<MainAgentMessage>;
}) {
  const textId = `conversation-${crypto.randomUUID()}`;
  const reply = buildWorkerConversationReply(input);

  void writeMainAgentTrace(
    input.dependencies,
    "dashboard-engine",
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
