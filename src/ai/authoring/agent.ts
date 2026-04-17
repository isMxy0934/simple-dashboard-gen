import {
  createAgentUIStream,
  createUIMessageStream,
  safeValidateUIMessages,
  stepCountIs,
  ToolLoopAgent,
  type UIMessageStreamOnFinishCallback,
  type UIMessageStreamOnStepFinishCallback,
} from "ai";
import type { DashboardDocument } from "@/contracts";
import { resolveProviderModelConfig } from "@/ai/providers";
import type {
  AuthoringIntent,
  AuthoringMessage,
  AuthoringSkillSummary,
  DatasourceListItemSummary,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringRunCheckStateSnapshot,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session-state";
import type { AuthoringDependencies } from "@/ai/authoring/engine/dependencies";
import { buildAuthoringTools } from "@/ai/authoring/tools";
import { buildAuthoringSystemPrompt } from "@/ai/authoring/prompt";
import { computeAuthoringScope } from "@/ai/authoring/scope";
import { buildViewListSummary } from "@/ai/authoring/context/context-summary";
import { buildAuthoringContextBlock } from "@/ai/authoring/context/context-block";
import { injectAuthoringContext } from "@/ai/authoring/context/inject-context";
import { redactSupersededToolOutputs } from "@/ai/authoring/messages/redact";
import {
  invalidateMutatedReads,
  type MutationDescriptor,
} from "@/ai/authoring/messages/invalidate-on-mutation";
import {
  createValidationOnlyAuthoringDependencies,
  writeAuthoringTrace,
} from "@/ai/authoring/engine/dependencies";
import { findLatestDraftOutput } from "@/ai/authoring/messages/inspection";

function buildScopeInput(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  messages: AuthoringMessage[];
  focusedViewId?: string | null;
  checks?: ViewCheckSnapshot[] | null;
  skills?: AuthoringSkillSummary[] | null;
  stepHistoryInTurn?: Array<{ toolName: string; outcome: "ok" | "error" }>;
  intent?: AuthoringIntent | null;
}) {
  const summary = buildViewListSummary({
    document: input.dashboard,
    dashboardId: input.dashboardId,
    checks: input.checks,
  });
  const checksSummary = (input.checks ?? []).reduce(
    (acc, check) => {
      if (check.status === "error") {
        acc.error += 1;
      } else if (check.status === "ok") {
        acc.ok += 1;
      } else if (check.status === "empty") {
        acc.warning += 1;
      }
      return acc;
    },
    { ok: 0, warning: 0, error: 0 },
  );

  return {
    dashboard: {
      id: input.dashboardId ?? null,
      name: input.dashboard.dashboard_spec.dashboard.name,
      views: summary.views.map((view) => ({
        id: view.id,
        title: view.title,
        renderer_kind: view.renderer_kind,
        check_status: view.check_status,
      })),
      datasources: input.datasources ?? [],
      checksSummary,
    },
    messages: input.messages,
    focusedViewId: input.focusedViewId ?? null,
    stepHistoryInTurn: input.stepHistoryInTurn ?? [],
    skills: input.skills ?? [],
    intentSignal: input.intent ?? null,
  };
}

export async function safeValidateMessages(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  messages: unknown;
  dependencies?: AuthoringDependencies;
}) {
  const tools = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    dependencies: input.dependencies ?? createValidationOnlyAuthoringDependencies(),
  }).tools;

  return safeValidateUIMessages<AuthoringMessage>({
    messages: input.messages,
    tools: tools as never,
  });
}

export async function createAuthoringAgentStream(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: AuthoringSkillSummary[] | null;
  checks?: ViewCheckSnapshot[] | null;
  messages: AuthoringMessage[];
  initialWorkingDraft?: AuthoringWorkingDraftSnapshot | null;
  initialLastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
  sessionId?: string;
  abortSignal?: AbortSignal;
  dependencies?: AuthoringDependencies;
  /** Optional UI-declared intent forwarded to the scope layer. */
  intent?: AuthoringIntent | null;
  onStepFinish?: UIMessageStreamOnStepFinishCallback<AuthoringMessage>;
  onFinish?: UIMessageStreamOnFinishCallback<AuthoringMessage>;
}) {
  const runtime = resolveProviderModelConfig();
  if (!input.dependencies) {
    throw new Error("Authoring dependencies are required to create the agent stream.");
  }
  const initialDecision = computeAuthoringScope(
    buildScopeInput({
      dashboard: input.dashboard,
      dashboardId: input.dashboardId,
      datasources: input.datasources,
      messages: input.messages,
      focusedViewId: input.focusedViewId,
      checks: input.checks,
      skills: input.skills,
      intent: input.intent,
    }),
  );
  const toolRuntime = buildAuthoringTools({
    scope: initialDecision.scope,
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    skills: input.skills,
    messages: input.messages,
    checks: input.checks,
    initialWorkingDraft: input.initialWorkingDraft,
    dependencies: input.dependencies,
    initialLastRunCheckState: input.initialLastRunCheckState,
  });
  const latestDraft = findLatestDraftOutput(input.messages);
  const contextBlock = buildAuthoringContextBlock({
    variant: initialDecision.contextBlockVariant,
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    focusedViewId:
      initialDecision.scope.kind === "focused"
        ? initialDecision.scope.viewId
        : input.focusedViewId,
    datasources: input.datasources,
    checks: input.checks,
    proposalSummary: latestDraft
      ? {
          proposal_id: latestDraft.suggestion.id,
          summary: latestDraft.suggestion.summary,
          operation_count: latestDraft.suggestion.patch.operations.length,
        }
      : null,
  });
  const modelMessages = injectAuthoringContext({
    messages: redactSupersededToolOutputs(input.messages),
    contextBlock: contextBlock.markdown,
  });

  const allMutationsThisTurn: MutationDescriptor[] = [];

  const agent = new ToolLoopAgent({
    id: "authoring-agent",
    model: runtime.model,
    instructions: buildAuthoringSystemPrompt({
      sections: initialDecision.systemPromptSections,
      scope: initialDecision.scope,
      skills: input.skills,
      relevantSkillIds: initialDecision.relevantSkillIds,
    }),
    tools: toolRuntime.tools,
    providerOptions: runtime.providerOptions,
    ...(runtime.supportsTemperature ? { temperature: 0.2 } : {}),
    stopWhen: stepCountIs(20),
    prepareStep: async ({ messages, steps, stepNumber }) => {
      const stepHistory = steps.flatMap((step) =>
        (step.toolCalls ?? []).map((call) => ({
          toolName: call.toolName,
          outcome: (step.toolResults ?? []).some(
            (result) => result.toolName === call.toolName,
          )
            ? ("ok" as const)
            : ("error" as const),
        })),
      );

      const newMutations = toolRuntime.drainMutations();
      for (const mutation of newMutations) {
        allMutationsThisTurn.push(mutation);
      }

      let typedMessages = messages as unknown as AuthoringMessage[];
      for (const mutation of allMutationsThisTurn) {
        typedMessages = invalidateMutatedReads(typedMessages, mutation);
      }

      const decision = computeAuthoringScope(
        buildScopeInput({
          dashboard: input.dashboard,
          dashboardId: input.dashboardId,
          datasources: input.datasources,
          messages: typedMessages,
          focusedViewId: input.focusedViewId,
          checks: input.checks,
          skills: input.skills,
          stepHistoryInTurn: stepHistory,
          intent: input.intent,
        }),
      );

      await writeAuthoringTrace(
        input.dependencies,
        "authoring-agent",
        "prepare-step",
        {
          sessionId: input.sessionId,
          stepNumber,
          mode: decision.mode,
          scope: decision.scope,
          activeTools: decision.activeTools,
          toolChoice: decision.toolChoice,
          mutationsApplied: allMutationsThisTurn.length,
        },
      );

      return {
        messages: redactSupersededToolOutputs(typedMessages),
        system: buildAuthoringSystemPrompt({
          sections: decision.systemPromptSections,
          scope: decision.scope,
          skills: input.skills,
          relevantSkillIds: decision.relevantSkillIds,
        }),
        activeTools: decision.activeTools,
        toolChoice: decision.toolChoice,
      } as never;
    },
  });

  const agentStream = await createAgentUIStream({
    agent,
    uiMessages: modelMessages,
    originalMessages: input.messages as never,
    abortSignal: input.abortSignal,
  });

  return {
    stream: createUIMessageStream({
      originalMessages: input.messages,
      onStepFinish: input.onStepFinish,
      onFinish: input.onFinish,
      execute: ({ writer }) => {
        writer.write({
          type: "data-authoring_scope",
          data: {
            ...initialDecision,
            contextFingerprint: contextBlock.fingerprint,
          },
        });
        if (input.checks?.length) {
          writer.write({
            type: "data-authoring_checks",
            data: input.checks,
          });
        }
        writer.merge(agentStream);
      },
    }),
    getDraftSnapshot: toolRuntime.getDraftSnapshot,
    getLastRunCheckStateSnapshot: toolRuntime.getLastRunCheckStateSnapshot,
    contextFingerprint: contextBlock.fingerprint,
  };
}
