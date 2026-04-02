import {
  createAgentUIStream,
  safeValidateUIMessages,
  stepCountIs,
  ToolLoopAgent,
} from "ai";
import type { DashboardDocument } from "@/contracts";
import type {
  DatasourceListItemSummary,
  DashboardAgentMessage,
  DashboardAgentTools,
} from "@/ai/dashboard-agent/contracts/agent-contract";
import { resolveProviderModelConfig } from "@/ai/providers";
import { summarizeAgentToolResult } from "@/ai/dashboard-agent/tools/adapters";
import type {
  ActiveDashboardAgentToolName,
  DashboardAgentWorkflow,
} from "@/ai/dashboard-agent/workflow";
import { buildDashboardAgentTools } from "@/ai/dashboard-agent/tools/tools";
import {
  writeDashboardAgentTrace,
  type DashboardAgentDependencies,
} from "@/ai/dashboard-agent/engine/dependencies";

type DashboardAgentToolName = keyof DashboardAgentTools & string;

export async function safeValidateDashboardAgentMessages(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  messages: unknown;
  dependencies?: DashboardAgentDependencies;
}) {
  const tools = buildDashboardAgentTools({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    dependencies: input.dependencies,
  });

  return safeValidateUIMessages<DashboardAgentMessage>({
    messages: input.messages,
    tools: tools as never,
  });
}

export async function createDashboardAgentStream(input: {
  workflow: DashboardAgentWorkflow;
  messages: DashboardAgentMessage[];
  abortSignal?: AbortSignal;
  dependencies?: DashboardAgentDependencies;
  sessionId?: string;
}) {
  return createAgentUIStream({
    agent: buildDashboardAgent({
      workflow: input.workflow,
      dependencies: input.dependencies,
      sessionId: input.sessionId,
    }),
    uiMessages: input.messages,
    abortSignal: input.abortSignal,
  });
}

function buildDashboardAgent(input: {
  workflow: DashboardAgentWorkflow;
  dependencies?: DashboardAgentDependencies;
  sessionId?: string;
}) {
  const runtime = resolveProviderModelConfig();

  return new ToolLoopAgent({
    id: "dashboard-agent",
    model: runtime.model,
    instructions: input.workflow.instructions,
    tools: input.workflow.tools,
    providerOptions: runtime.providerOptions,
    ...(runtime.supportsTemperature ? { temperature: 0.2 } : {}),
    stopWhen: stepCountIs(20),
    prepareStep: async (params) => {
      const decision = prepareDashboardAgentStep({
        activeTools: input.workflow.activeTools,
        priorToolNames: params.steps.flatMap((step) =>
          (step.toolCalls ?? []).map((call) => call.toolName as DashboardAgentToolName),
        ),
      });
      await writeDashboardAgentTrace(
        input.dependencies,
        "dashboard-agent",
        "prepare-step",
        {
          sessionId: input.sessionId,
          stepNumber: params.stepNumber,
          activeTools: decision.activeTools,
          toolChoice: decision.toolChoice,
        },
      );
      return decision as never;
    },
    onStepFinish: async ({
      stepNumber,
      text,
      toolCalls,
      toolResults,
      finishReason,
      usage,
    }) => {
      await writeDashboardAgentTrace(
        input.dependencies,
        "dashboard-agent",
        "step-finished",
        {
          sessionId: input.sessionId,
          stepNumber,
          text_preview: text.slice(0, 600),
          toolCalls: toolCalls.map((call) => ({
            toolName: call.toolName,
            input: call.input,
          })),
          toolResults: toolResults.map((result) =>
            summarizeAgentToolResult(result.output),
          ),
          finishReason,
          usage,
        },
      );
    },
    onFinish: async ({ text, finishReason, response, steps, totalUsage }) => {
      await writeDashboardAgentTrace(
        input.dependencies,
        "dashboard-agent",
        "run-finished",
        {
          sessionId: input.sessionId,
          text_preview: text.slice(0, 800),
          finishReason,
          step_count: steps.length,
          response_message_count: response.messages.length,
          totalUsage,
        },
      );
    },
    experimental_onToolCallStart: async ({ toolCall }) => {
      await writeDashboardAgentTrace(
        input.dependencies,
        "dashboard-agent",
        "tool-call-start",
        {
          sessionId: input.sessionId,
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          input: toolCall.input,
        },
      );
    },
    experimental_onToolCallFinish: async ({
      toolCall,
      output,
      error,
      durationMs,
    }) => {
      await writeDashboardAgentTrace(
        input.dependencies,
        "dashboard-agent",
        "tool-call-finish",
        {
          sessionId: input.sessionId,
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          input: toolCall.input,
          output: summarizeAgentToolResult(output),
          error,
          durationMs,
        },
      );
    },
  });
}

function prepareDashboardAgentStep(input: {
  activeTools: ActiveDashboardAgentToolName[];
  priorToolNames: DashboardAgentToolName[];
}) {
  if (input.priorToolNames.includes("applyPatch")) {
    return {
      toolChoice: "none" as const,
      activeTools: [] as DashboardAgentToolName[],
    };
  }

  if (
    input.priorToolNames.includes("composePatch") &&
    !input.priorToolNames.includes("applyPatch")
  ) {
    return {
      activeTools: ["applyPatch"] as DashboardAgentToolName[],
      toolChoice: {
        type: "tool" as const,
        toolName: "applyPatch" as const,
      },
    };
  }

  return {
    activeTools: input.activeTools as DashboardAgentToolName[],
  };
}
