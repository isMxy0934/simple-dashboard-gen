import {
  createAgentUIStream,
  safeValidateUIMessages,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
} from "ai";
import type { DashboardDocument } from "@/contracts";
import type {
  DatasourceListItemSummary,
  MainAgentMessage,
} from "@/ai/main-agent/contracts/agent-contract";
import { resolveProviderModelConfig } from "@/ai/providers";
import {
  writeMainAgentTrace,
  type MainAgentDependencies,
} from "@/ai/main-agent/engine/dependencies";

type WorkerToolName = string;

export async function safeValidateWorkerMessagesCore(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  messages: unknown;
  dependencies?: MainAgentDependencies;
  buildTools: (args: {
    dashboard: DashboardDocument;
    dashboardId?: string | null;
    datasources?: DatasourceListItemSummary[] | null;
    dependencies?: MainAgentDependencies;
  }) => { tools: ToolSet };
}) {
  const tools = input.buildTools({
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

export async function createWorkerAgentStreamCore(input: {
  workerId: "dashboard-worker" | "view-worker";
  instructions: string;
  tools: ToolSet;
  activeTools: string[];
  messages: MainAgentMessage[];
  originalMessages?: MainAgentMessage[];
  abortSignal?: AbortSignal;
  dependencies?: MainAgentDependencies;
  sessionId?: string;
  summarizeToolResult: (output: unknown) => unknown;
}) {
  const runtime = resolveProviderModelConfig();

  const agent = new ToolLoopAgent({
    id: input.workerId,
    model: runtime.model,
    instructions: input.instructions,
    tools: input.tools,
    providerOptions: runtime.providerOptions,
    ...(runtime.supportsTemperature ? { temperature: 0.2 } : {}),
    stopWhen: stepCountIs(20),
    prepareStep: async (params) => {
      const decision = prepareWorkerStep({
        activeTools: input.activeTools,
        priorToolNames: params.steps.flatMap((step) =>
          (step.toolCalls ?? []).map((call) => call.toolName as WorkerToolName),
        ),
      });
      await writeMainAgentTrace(
        input.dependencies,
        input.workerId,
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
        input.workerId,
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
            input.summarizeToolResult(result.output),
          ),
          finishReason,
          usage,
        },
      );
    },
    onFinish: async ({ text, finishReason, response, steps, totalUsage }) => {
      await writeMainAgentTrace(
        input.dependencies,
        input.workerId,
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
        input.workerId,
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
        input.workerId,
        "tool-call-finish",
        {
          sessionId: input.sessionId,
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          input: toolCall.input,
          output: input.summarizeToolResult(output),
          error,
          durationMs,
        },
      );
    },
  });

  return createAgentUIStream({
    agent,
    uiMessages: input.messages,
    originalMessages:
      ((input.originalMessages ?? input.messages) as unknown[]) as never,
    abortSignal: input.abortSignal,
  });
}

function prepareWorkerStep(input: {
  activeTools: string[];
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
