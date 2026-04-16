import {
  createAgentUIStream,
  safeValidateUIMessages,
  stepCountIs,
  ToolLoopAgent,
} from "ai";
import type { DashboardDocument } from "@/contracts";
import type {
  DatasourceListItemSummary,
  MainAgentMessage,
  MainAgentTools,
} from "@/ai/main-agent/contracts/agent-contract";
import { resolveProviderModelConfig } from "@/ai/providers";
import { summarizeAgentToolResult } from "@/ai/dashboard-worker/tools/adapters";
import type {
  ActiveWorkerToolName,
  WorkerWorkflow,
} from "@/ai/dashboard-worker/workflow";
import { buildMainAgentTools } from "@/ai/dashboard-worker/tools/tools";
import {
  writeMainAgentTrace,
  type MainAgentDependencies,
} from "@/ai/main-agent/engine/dependencies";

type WorkerToolName = keyof MainAgentTools & string;

export async function safeValidateMainAgentMessages(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  messages: unknown;
  dependencies?: MainAgentDependencies;
}) {
  const tools = buildMainAgentTools({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    dependencies: input.dependencies,
  }).tools;

  return safeValidateUIMessages<MainAgentMessage>({
    messages: input.messages,
    tools: tools as never,
  });
}

export async function createWorkerAgentStream(input: {
  workflow: WorkerWorkflow;
  messages: MainAgentMessage[];
  originalMessages?: MainAgentMessage[];
  abortSignal?: AbortSignal;
  dependencies?: MainAgentDependencies;
  sessionId?: string;
}) {
  return createAgentUIStream({
    agent: buildWorkerAgent({
      workflow: input.workflow,
      dependencies: input.dependencies,
      sessionId: input.sessionId,
    }),
    uiMessages: input.messages,
    originalMessages:
      ((input.originalMessages ?? input.messages) as unknown[]) as never,
    abortSignal: input.abortSignal,
  });
}

function buildWorkerAgent(input: {
  workflow: WorkerWorkflow;
  dependencies?: MainAgentDependencies;
  sessionId?: string;
}) {
  const runtime = resolveProviderModelConfig();

  return new ToolLoopAgent({
    id: "dashboard-worker",
    model: runtime.model,
    instructions: input.workflow.instructions,
    tools: input.workflow.tools,
    providerOptions: runtime.providerOptions,
    ...(runtime.supportsTemperature ? { temperature: 0.2 } : {}),
    stopWhen: stepCountIs(20),
    prepareStep: async (params) => {
      const decision = prepareWorkerStep({
        activeTools: input.workflow.activeTools,
        priorToolNames: params.steps.flatMap((step) =>
          (step.toolCalls ?? []).map((call) => call.toolName as WorkerToolName),
        ),
      });
      await writeMainAgentTrace(
        input.dependencies,
        "dashboard-worker",
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
      await writeMainAgentTrace(
        input.dependencies,
        "dashboard-worker",
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
      await writeMainAgentTrace(
        input.dependencies,
        "dashboard-worker",
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
      await writeMainAgentTrace(
        input.dependencies,
        "dashboard-worker",
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
      await writeMainAgentTrace(
        input.dependencies,
        "dashboard-worker",
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

function prepareWorkerStep(input: {
  activeTools: ActiveWorkerToolName[];
  priorToolNames: WorkerToolName[];
}) {
  if (input.priorToolNames.includes("applyPatch")) {
    return {
      toolChoice: "none" as const,
      activeTools: [] as WorkerToolName[],
    };
  }

  return {
    activeTools: input.activeTools as WorkerToolName[],
  };
}
