import {
  createUIMessageStream,
  type UIMessageStreamOnFinishCallback,
  type UIMessageStreamOnStepFinishCallback,
} from "ai";
import type {
  DashboardDocument,
  DatasourceContext,
} from "../../contracts";
import type { AuthoringAgentMessage } from "./agent-contract";
import {
  summarizeAuthoringRouteDecision,
  type AuthoringRouteDecision,
} from "./authoring-route";
import {
  writeAiDebugLog,
  type DashboardAiDependencies,
} from "./dependencies";
import { createDashboardAgentStream } from "../agent/dashboard-authoring-agent";
import {
  buildDashboardConversationReply,
  createDashboardAuthoringWorkflow,
} from "../workflow/dashboard-authoring-workflow";

export async function createDashboardAgentRuntimeStream(input: {
  dashboard: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
  messages: AuthoringAgentMessage[];
  /** Correlates debug.log lines for one HTTP request. */
  sessionKey?: string;
  abortSignal?: AbortSignal;
  onStepFinish?: UIMessageStreamOnStepFinishCallback<AuthoringAgentMessage>;
  onFinish?: UIMessageStreamOnFinishCallback<AuthoringAgentMessage>;
  dependencies?: DashboardAiDependencies;
}) {
  const workflow = createDashboardAuthoringWorkflow({
    dashboard: input.dashboard,
    datasourceContext: input.datasourceContext,
    messages: input.messages,
    dependencies: input.dependencies,
  });

  await writeAiDebugLog(input.dependencies, "dashboard-runtime", "route-decision", {
    sessionKey: input.sessionKey,
    route: workflow.routeDecision.route,
    summary: summarizeAuthoringRouteDecision(workflow.routeDecision),
    signals: workflow.routeDecision.signals,
    has_pending_approval: workflow.routeDecision.route === "approval",
    workflow_active_stage: workflow.summary.active_stage,
    workflow_active_tools: workflow.activeTools,
  });

  if (workflow.routeDecision.route !== "authoring") {
    await writeAiDebugLog(input.dependencies, "dashboard-runtime", "branch", {
      sessionKey: input.sessionKey,
      branch: "conversation-reply",
      route: workflow.routeDecision.route,
    });
    return createConversationResponseStream({
      ...input,
      workflow,
      routeDecision: workflow.routeDecision,
    });
  }

  await writeAiDebugLog(input.dependencies, "dashboard-runtime", "branch", {
    sessionKey: input.sessionKey,
    branch: "tool-loop-agent",
    route: workflow.routeDecision.route,
  });

  const agentStream = await createDashboardAgentStream({
    workflow,
    messages: input.messages,
    abortSignal: input.abortSignal,
    dependencies: input.dependencies,
    sessionKey: input.sessionKey,
  });

  return createUIMessageStream({
    originalMessages: input.messages,
    onStepFinish: input.onStepFinish,
    onFinish: input.onFinish,
    execute: ({ writer }) => {
      writer.write({
        type: "data-authoring_route",
        data: workflow.routeDecision,
      });
      writer.write({
        type: "data-authoring_workflow",
        data: workflow.summary,
      });
      writer.merge(agentStream);
    },
  });
}

function createConversationResponseStream(input: {
  dashboard: DashboardDocument;
  messages: AuthoringAgentMessage[];
  workflow: ReturnType<typeof createDashboardAuthoringWorkflow>;
  routeDecision: AuthoringRouteDecision;
  sessionKey?: string;
  dependencies?: DashboardAiDependencies;
  onFinish?: UIMessageStreamOnFinishCallback<AuthoringAgentMessage>;
}) {
  const textId = `conversation-${crypto.randomUUID()}`;
  const reply = buildDashboardConversationReply(input);

  void writeAiDebugLog(input.dependencies, "dashboard-runtime", "conversation-reply", {
    sessionKey: input.sessionKey,
    char_length: reply.length,
    preview: reply.slice(0, 800),
  });

  return createUIMessageStream({
    originalMessages: input.messages,
    onFinish: input.onFinish,
    execute: ({ writer }) => {
      writer.write({
        type: "data-authoring_route",
        data: input.routeDecision,
      });
      writer.write({
        type: "data-authoring_workflow",
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
