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
  AuthoringMessage,
  AuthoringSkillSummary,
  DatasourceListItemSummary,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringWorkingDraftSnapshot } from "@/ai/authoring/contracts/session-state";
import type { AuthoringDependencies } from "@/ai/authoring/engine/dependencies";
import { buildAuthoringTools } from "@/ai/authoring/tools";
import { buildAuthoringSystemPrompt } from "@/ai/authoring/prompt";
import { computeAuthoringScope } from "@/ai/authoring/scope";
import { buildViewListSummary } from "@/ai/authoring/context/context-summary";
import { buildAuthoringContextBlock } from "@/ai/authoring/context/context-block";
import { injectAuthoringContext } from "@/ai/authoring/context/inject-context";
import { redactSupersededToolOutputs } from "@/ai/authoring/messages/redact";
import { writeAuthoringTrace } from "@/ai/authoring/engine/dependencies";

function buildScopeInput(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  messages: AuthoringMessage[];
  focusedViewId?: string | null;
  checks?: ViewCheckSnapshot[] | null;
  skills?: AuthoringSkillSummary[] | null;
  stepHistoryInTurn?: Array<{ toolName: string; outcome: "ok" | "error" }>;
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
    dependencies: input.dependencies,
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
  sessionId?: string;
  abortSignal?: AbortSignal;
  dependencies?: AuthoringDependencies;
  onStepFinish?: UIMessageStreamOnStepFinishCallback<AuthoringMessage>;
  onFinish?: UIMessageStreamOnFinishCallback<AuthoringMessage>;
}) {
  const runtime = resolveProviderModelConfig();
  const initialDecision = computeAuthoringScope(
    buildScopeInput({
      dashboard: input.dashboard,
      dashboardId: input.dashboardId,
      datasources: input.datasources,
      messages: input.messages,
      focusedViewId: input.focusedViewId,
      checks: input.checks,
      skills: input.skills,
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
  });
  const latestDraft = input.messages.length
    ? null
    : null;
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
    proposalSummary: latestDraft,
  });
  const modelMessages = injectAuthoringContext({
    messages: redactSupersededToolOutputs(input.messages),
    contextBlock: contextBlock.markdown,
  });

  const agent = new ToolLoopAgent({
    id: "authoring-agent",
    model: runtime.model,
    instructions: buildAuthoringSystemPrompt({
      mode: initialDecision.mode,
      scope: initialDecision.scope,
      skills: input.skills,
      relevantSkillIds: initialDecision.relevantSkillIds,
    }),
    tools: toolRuntime.tools,
    providerOptions: runtime.providerOptions,
    ...(runtime.supportsTemperature ? { temperature: 0.2 } : {}),
    stopWhen: stepCountIs(12),
    prepareStep: async ({ messages, steps, stepNumber }) => {
      const decision = computeAuthoringScope(
        buildScopeInput({
          dashboard: input.dashboard,
          dashboardId: input.dashboardId,
          datasources: input.datasources,
          messages: messages as unknown as AuthoringMessage[],
          focusedViewId: input.focusedViewId,
          checks: input.checks,
          skills: input.skills,
          stepHistoryInTurn: steps.flatMap((step) =>
            (step.toolCalls ?? []).map((call) => ({
              toolName: call.toolName,
              outcome: (step.toolResults ?? []).some(
                (result) => result.toolName === call.toolName,
              )
                ? ("ok" as const)
                : ("error" as const),
            })),
          ),
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
        },
      );

      return {
        messages: redactSupersededToolOutputs(messages as unknown as AuthoringMessage[]),
        system: buildAuthoringSystemPrompt({
          mode: decision.mode,
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
    contextFingerprint: contextBlock.fingerprint,
  };
}
