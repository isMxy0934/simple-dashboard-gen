import { generateText, Output } from "ai";
import { z } from "zod";
import type { AuthoringApprovalEvent, AuthoringIntent } from "@/ai/authoring/contracts/tool-io";
import type { TurnIntentV2, ViewGoalV2 } from "@/ai/authoring/v2/types";
import { getChartCapabilitiesV2 } from "@/ai/authoring/v2/chart-capabilities";

const dataModeSchema = z.enum(["live", "mock", "undecided"]);

const viewGoalSchema = z.object({
  summary: z.string().optional(),
  dataMode: dataModeSchema.optional(),
  chartType: z.string().optional(),
  metrics: z.array(z.string()).optional(),
  dimensions: z.array(z.string()).optional(),
  timeGrain: z.enum(["day", "week", "month"]).optional(),
  datasourceId: z.string().optional(),
  table: z.string().optional(),
  targetViewId: z.string().optional(),
  targetViewTitle: z.string().optional(),
});

const extractedIntentSchema = z.object({
  kind: z.enum([
    "chat",
    "explore_data",
    "advise_analysis",
    "set_data_mode",
    "create_view",
    "revise_view",
    "create_dashboard",
    "approve_patch_text",
  ]),
  scope: z.enum(["datasources", "schema"]).optional(),
  datasourceId: z.string().optional(),
  table: z.string().optional(),
  dataMode: dataModeSchema.optional(),
  decision: z.enum(["approve", "reject", "revise"]).optional(),
  goal: viewGoalSchema.optional(),
  dashboardGoal: z.object({
    summary: z.string().optional(),
    dataMode: dataModeSchema.optional(),
    datasourceId: z.string().optional(),
    table: z.string().optional(),
    views: z.array(viewGoalSchema).min(1).max(8),
  }).optional(),
});

type ExtractedIntent = z.infer<typeof extractedIntentSchema>;

function cleanString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanViewGoal(goal: z.infer<typeof viewGoalSchema> | undefined, fallback: string): ViewGoalV2 {
  return {
    summary: cleanString(goal?.summary) ?? fallback,
    ...(goal?.dataMode ? { dataMode: goal.dataMode } : {}),
    ...(cleanString(goal?.chartType) ? { chartType: cleanString(goal?.chartType) } : {}),
    ...(goal?.metrics?.length ? { metrics: goal.metrics.map((entry) => entry.trim()).filter(Boolean) } : {}),
    ...(goal?.dimensions?.length ? { dimensions: goal.dimensions.map((entry) => entry.trim()).filter(Boolean) } : {}),
    ...(goal?.timeGrain ? { timeGrain: goal.timeGrain } : {}),
    ...(cleanString(goal?.datasourceId) ? { datasourceId: cleanString(goal?.datasourceId) } : {}),
    ...(cleanString(goal?.table) ? { table: cleanString(goal?.table) } : {}),
    ...(cleanString(goal?.targetViewId) ? { targetViewId: cleanString(goal?.targetViewId) } : {}),
    ...(cleanString(goal?.targetViewTitle) ? { targetViewTitle: cleanString(goal?.targetViewTitle) } : {}),
  };
}

function toTurnIntent(extracted: ExtractedIntent, latestUserText: string): TurnIntentV2 {
  switch (extracted.kind) {
    case "explore_data":
      return {
        kind: "explore_data",
        scope: extracted.scope ?? "datasources",
        ...(cleanString(extracted.datasourceId) ? { datasourceId: cleanString(extracted.datasourceId) } : {}),
        ...(cleanString(extracted.table) ? { table: cleanString(extracted.table) } : {}),
      };
    case "advise_analysis":
      return { kind: "advise_analysis" };
    case "set_data_mode":
      return extracted.dataMode === "live" || extracted.dataMode === "mock"
        ? { kind: "set_data_mode", dataMode: extracted.dataMode }
        : { kind: "chat" };
    case "create_view":
      return {
        kind: "create_view",
        goal: cleanViewGoal(extracted.goal, latestUserText),
      };
    case "revise_view":
      return {
        kind: "revise_view",
        goal: cleanViewGoal(extracted.goal, latestUserText),
      };
    case "create_dashboard":
      return {
        kind: "create_dashboard",
        goal: {
          summary: cleanString(extracted.dashboardGoal?.summary) ?? latestUserText,
          ...(extracted.dashboardGoal?.dataMode ? { dataMode: extracted.dashboardGoal.dataMode } : {}),
          ...(cleanString(extracted.dashboardGoal?.datasourceId)
            ? { datasourceId: cleanString(extracted.dashboardGoal?.datasourceId) }
            : {}),
          ...(cleanString(extracted.dashboardGoal?.table)
            ? { table: cleanString(extracted.dashboardGoal?.table) }
            : {}),
          views: (extracted.dashboardGoal?.views ?? [extracted.goal])
            .filter((goal): goal is z.infer<typeof viewGoalSchema> => Boolean(goal))
            .map((goal, index) => cleanViewGoal(goal, `${latestUserText} #${index + 1}`)),
        },
      };
    case "approve_patch_text":
      return {
        kind: "approve_patch_text",
        decision: extracted.decision ?? "revise",
      };
    case "chat":
    default:
      return { kind: "chat" };
  }
}

function buildIntentPrompt(input: {
  latestUserText: string;
  hasPendingProposal: boolean;
}) {
  const capabilities = getChartCapabilitiesV2().map((capability) => ({
    chartType: capability.chartType,
    viewType: capability.viewType,
    aliases: capability.intentAliases,
    supportsCreate: capability.supportsCreate,
    supportsRevise: capability.supportsRevise,
  }));
  return [
    "Extract the user's dashboard authoring intent into the requested JSON schema.",
    "Do not execute the task. Classify only the current latest user text.",
    "Use chat for questions, explanations, or destructive hypotheticals such as asking whether something can be deleted.",
    "Use explore_data when the user asks what data/schema/fields/tables are available or asks to inspect current chart meaning.",
    "Use create_view for one new chart/view/report card.",
    "Use revise_view for changing an existing chart/view, including chart type, metric, time grain, data source, or fields.",
    "Use create_dashboard when the user asks for a dashboard/report with multiple charts/views/cards.",
    "Only use approve_patch_text when the user is clearly approving or rejecting a pending patch proposal.",
    `Pending patch proposal: ${input.hasPendingProposal ? "yes" : "no"}.`,
    `Known chart capabilities: ${JSON.stringify(capabilities)}.`,
    `Latest user text: ${input.latestUserText}`,
  ].join("\n");
}

export async function extractTurnIntentV2(input: {
  explicitIntent?: AuthoringIntent | null;
  latestUserText?: string | null;
  approvalEvent?: AuthoringApprovalEvent | null;
  hasPendingProposal?: boolean;
  model: Parameters<typeof generateText>[0]["model"];
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
  supportsTemperature?: boolean;
  abortSignal?: AbortSignal;
}): Promise<TurnIntentV2 | null> {
  if (input.approvalEvent) {
    return {
      kind: "approve_patch_event",
      proposalId: input.approvalEvent.proposalId,
      decision: input.approvalEvent.decision,
      baseVersion: input.approvalEvent.baseVersion,
    };
  }
  if (input.explicitIntent === "apply" || input.explicitIntent === "cancel") {
    return null;
  }
  if (input.explicitIntent === "explore") {
    return { kind: "explore_data", scope: "datasources" };
  }
  if (input.explicitIntent === "ask-capability") {
    return { kind: "chat" };
  }

  const latestUserText = input.latestUserText?.trim() ?? "";
  if (!latestUserText) {
    return { kind: "chat" };
  }

  const result = await generateText({
    model: input.model,
    output: Output.object({
      schema: extractedIntentSchema,
      name: "AuthoringTurnIntentV2",
      description: "Structured dashboard authoring intent for the latest user turn.",
    }),
    providerOptions: input.providerOptions,
    ...(input.supportsTemperature ? { temperature: 0 } : {}),
    abortSignal: input.abortSignal,
    prompt: buildIntentPrompt({
      latestUserText,
      hasPendingProposal: Boolean(input.hasPendingProposal),
    }),
  });

  return toTurnIntent(result.output, latestUserText);
}
