import {
  createAgentUIStream,
  safeValidateUIMessages,
  stepCountIs,
  ToolLoopAgent,
} from "ai";
import type {
  DashboardDocument,
  DatasourceContext,
} from "../../contracts";
import type {
  AuthoringAgentMessage,
  AuthoringAgentTools,
} from "../runtime/agent-contract";
import { resolveAiModelConfig } from "../provider";
import { summarizeAgentToolResult } from "../authoring/adapters";
import {
  resolveDashboardAuthoringSkillSet,
} from "../skills/skill-registry";
import {
  writeAiDebugLog,
  type DashboardAiDependencies,
} from "../runtime/dependencies";
import type {
  ActiveDashboardAgentToolName,
  AuthoringRuntimeControl,
  DashboardAuthoringWorkflow,
} from "../workflow/dashboard-authoring-workflow";

type DashboardAgentToolName = keyof AuthoringAgentTools & string;

export async function safeValidateDashboardAgentMessages(input: {
  dashboard: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
  messages: unknown;
  dependencies?: DashboardAiDependencies;
}) {
  const skillSet = resolveDashboardAuthoringSkillSet({
    dashboard: input.dashboard,
    datasourceContext: input.datasourceContext,
    dependencies: input.dependencies,
  });

  return safeValidateUIMessages<AuthoringAgentMessage>({
    messages: input.messages,
    tools: skillSet.tools as never,
  });
}

export async function createDashboardAgentStream(input: {
  workflow: DashboardAuthoringWorkflow;
  messages: AuthoringAgentMessage[];
  abortSignal?: AbortSignal;
  dependencies?: DashboardAiDependencies;
  sessionKey?: string;
}) {
  return createAgentUIStream({
    agent: buildDashboardAuthoringAgent({
      workflow: input.workflow,
      dependencies: input.dependencies,
      sessionKey: input.sessionKey,
    }),
    uiMessages: input.messages,
    abortSignal: input.abortSignal,
  });
}

function buildDashboardAuthoringAgent(input: {
  workflow: DashboardAuthoringWorkflow;
  dependencies?: DashboardAiDependencies;
  sessionKey?: string;
}) {
  const runtime = resolveAiModelConfig();

  return new ToolLoopAgent({
    id: "dashboard-authoring-agent",
    model: runtime.model,
    instructions: input.workflow.instructions,
    tools: input.workflow.tools,
    activeTools: input.workflow.activeTools,
    providerOptions: runtime.providerOptions,
    ...(runtime.supportsTemperature ? { temperature: 0.2 } : {}),
    // Need headroom for retries (e.g. draftBindings error → redo) plus composePatch then applyPatch.
    // stepCountIs(6) stops right after composePatch as the 6th step, so applyPatch never runs → "stuck" UI.
    stopWhen: stepCountIs(20),
    prepareStep: async (params) => {
      const decision = prepareDashboardAgentStep(
        params,
        input.workflow.runtimeControl,
      );
      const priorToolNames = params.steps.flatMap((step) =>
        (step.toolCalls ?? []).map((call) => call.toolName),
      );
      await writeAiDebugLog(input.dependencies, "dashboard-agent", "prepare-step", {
        sessionKey: input.sessionKey,
        stepNumber: params.stepNumber,
        prior_tool_names: priorToolNames,
        activeTools: decision.activeTools,
        toolChoice: decision.toolChoice,
        model_message_count: params.messages.length,
      });
      return decision;
    },
    onStepFinish: async ({
      stepNumber,
      text,
      toolCalls,
      toolResults,
      finishReason,
      usage,
    }) => {
      await writeAiDebugLog(input.dependencies, "dashboard-agent", "step-finished", {
        sessionKey: input.sessionKey,
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
      });
    },
    onFinish: async ({ text, finishReason, response, steps, totalUsage }) => {
      await writeAiDebugLog(input.dependencies, "dashboard-agent", "run-finished", {
        sessionKey: input.sessionKey,
        text_preview: text.slice(0, 800),
        finishReason,
        step_count: steps.length,
        steps: steps.map((step) => ({
          stepNumber: step.stepNumber,
          finishReason: step.finishReason,
          toolCalls: step.toolCalls?.map((call) => ({
            toolName: call.toolName,
            input: call.input,
          })),
          text_preview: step.text?.slice(0, 400) ?? "",
        })),
        totalUsage,
        response_message_count: response.messages.length,
      });
    },
    experimental_onToolCallStart: async ({ toolCall }) => {
      await writeAiDebugLog(input.dependencies, "dashboard-agent", "tool-call-start", {
        sessionKey: input.sessionKey,
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        input: toolCall.input,
      });
    },
    experimental_onToolCallFinish: async ({
      toolCall,
      output,
      error,
      durationMs,
    }) => {
      await writeAiDebugLog(input.dependencies, "dashboard-agent", "tool-call-finish", {
        sessionKey: input.sessionKey,
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        input: toolCall.input,
        output: summarizeAgentToolResult(output),
        error,
        durationMs,
      });
    },
  });
}

function prepareDashboardAgentStep(
  {
    stepNumber,
    steps,
  }: {
    stepNumber: number;
    steps: Array<{
      toolCalls?: Array<{
        toolName: DashboardAgentToolName;
      }>;
    }>;
  },
  runtimeControl: AuthoringRuntimeControl,
) {
  const priorToolNames = steps.flatMap((step) =>
    (step.toolCalls ?? []).map((call) => call.toolName),
  );

  if (priorToolNames.includes("applyPatch")) {
    return {
      toolChoice: "none" as const,
      activeTools: [] as ActiveDashboardAgentToolName[],
    };
  }

  // Must run before any stepNumber cap: composePatch without applyPatch always hands off to approval.
  if (
    priorToolNames.includes("composePatch") &&
    !priorToolNames.includes("applyPatch")
  ) {
    return {
      activeTools: ["applyPatch"] as ActiveDashboardAgentToolName[],
      toolChoice: {
        type: "tool" as const,
        toolName: "applyPatch" as const,
      },
    };
  }

  if (
    priorToolNames.includes("draftBindings") &&
    !priorToolNames.includes("composePatch")
  ) {
    return {
      activeTools: ["composePatch"] as ActiveDashboardAgentToolName[],
      toolChoice: {
        type: "tool" as const,
        toolName: "composePatch" as const,
      },
    };
  }

  if (stepNumber >= 5) {
    return {
      toolChoice: "none" as const,
    };
  }

  if (runtimeControl.mode === "inspection") {
    if (priorToolNames.includes("runRuntimeCheck")) {
      return {
        toolChoice: "none" as const,
        activeTools: [] as ActiveDashboardAgentToolName[],
      };
    }

    if (priorToolNames.length >= 2) {
      return {
        toolChoice: "none" as const,
        activeTools: [] as ActiveDashboardAgentToolName[],
      };
    }

    return {
      activeTools: runtimeControl.activeTools,
    };
  }

  const activeTools = new Set<ActiveDashboardAgentToolName>(runtimeControl.activeTools);

  if (priorToolNames.includes("draftViews")) {
    activeTools.add("draftBindings");
    activeTools.add("composePatch");
  }

  if (priorToolNames.includes("draftQueryDefs")) {
    activeTools.add("draftBindings");
    activeTools.add("composePatch");
  }

  return {
    activeTools: [...activeTools],
  };
}
