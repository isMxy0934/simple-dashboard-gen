import { generateText, Output } from "ai";
import { z } from "zod";
import type {
  AuthoringRouteAdvice,
  AuthoringRouteAdviceRoute,
} from "@/ai/authoring/contracts/session-state";
import type { DatasourceListItemSummary } from "@/ai/authoring/contracts/tool-io";
import { hasConfirmedDataContext } from "@/ai/authoring/data-context-gate";
import type { AuthoringTaskStateSnapshot } from "@/ai/authoring/contracts/session-state";

type GenerateTextOptions = Parameters<typeof generateText>[0];

const routeAdviceSchema = z.object({
  route: z.enum([
    "chat",
    "explore",
    "author-dashboard",
    "author-focused",
    "approval",
  ]),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  dataContextStatus: z.enum([
    "missing",
    "candidate-recommended",
    "confirmed",
  ]),
  shouldAskBlocker: z.boolean(),
  recommendedSkillIds: z.array(z.string()).default([]),
});

export function buildFallbackRouteAdvice(input: {
  latestUserText: string;
  datasources: DatasourceListItemSummary[];
  hasFocusedView: boolean;
  hasPendingApproval: boolean;
  taskState?: AuthoringTaskStateSnapshot | null;
}): AuthoringRouteAdvice {
  const latest = input.latestUserText.trim();
  const confirmedData =
    hasConfirmedDataContext({
      latestUserText: latest,
      datasources: input.datasources,
    }) || Boolean(input.taskState?.selectedDataContext);
  const asksDataDiscovery = /有哪些|什么数据|哪些字段|schema|结构|可用数据/i.test(latest);
  const looksAffirmative = /^(好|好的|可以|可以的|行|对|是的|确认|ok|yes)$/i.test(
    latest.replace(/[\s，。！？!?]/g, ""),
  );
  const asksToDraft =
    /创建|生成|做出来|开始做|继续创建|继续做|落地|create|generate|build/i.test(
      latest,
    );
  const confirmsPreviousData =
    input.taskState?.phase === "awaiting_data_confirmation" &&
    (looksAffirmative || asksToDraft);
  const route: AuthoringRouteAdviceRoute = input.hasPendingApproval
    ? "approval"
    : asksDataDiscovery
      ? "explore"
      : input.hasFocusedView
        ? "author-focused"
        : "author-dashboard";

  return {
    route,
    reason:
      !confirmedData &&
      !confirmsPreviousData &&
      route !== "explore" &&
      route !== "approval"
        ? "Need a confirmed datasource/table or metric source before drafting."
        : "Fallback route derived from local conversation and task state.",
    confidence: 0.45,
    dataContextStatus:
      confirmedData ||
      confirmsPreviousData
        ? "confirmed"
        : "missing",
    shouldAskBlocker:
      route !== "explore" &&
      route !== "approval" &&
      !confirmedData &&
      !confirmsPreviousData,
    recommendedSkillIds: [],
  };
}

export async function requestAuthoringRouteAdvice(input: {
  model: GenerateTextOptions["model"];
  providerOptions?: GenerateTextOptions["providerOptions"];
  supportsTemperature?: boolean;
  abortSignal?: AbortSignal;
  latestUserText: string;
  dashboardSummary: {
    name: string;
    viewCount: number;
    focusedViewId?: string | null;
    hasPendingApproval: boolean;
  };
  datasources: DatasourceListItemSummary[];
  taskState?: AuthoringTaskStateSnapshot | null;
  availableSkillIds: string[];
}): Promise<AuthoringRouteAdvice> {
  const fallback = buildFallbackRouteAdvice({
    latestUserText: input.latestUserText,
    datasources: input.datasources,
    hasFocusedView: Boolean(input.dashboardSummary.focusedViewId),
    hasPendingApproval: input.dashboardSummary.hasPendingApproval,
    taskState: input.taskState,
  });

  const prompt = [
    "Decide the next authoring route. Return structured JSON only.",
    "The decision is advisory; code will enforce safety guards.",
    "",
    "Routes:",
    "- chat: answer conversationally with no tools",
    "- explore: inspect/read data or dashboard state only",
    "- author-dashboard: create or edit dashboard-level draft",
    "- author-focused: create or edit only the focused view",
    "- approval: continue an existing patch approval flow",
    "",
    "Prefer authoring after the user confirms a datasource/table or asks to create/generate/build.",
    "Use author-dashboard/author-focused with dataContextStatus=missing and shouldAskBlocker=true when datasource/table/metric meaning is missing.",
    "Use explore for questions like available data, schema, current state, or why something happened.",
    "",
    `Latest user text: ${input.latestUserText}`,
    `Dashboard: ${JSON.stringify(input.dashboardSummary)}`,
    `Datasources: ${JSON.stringify(input.datasources)}`,
    `Task state: ${JSON.stringify(input.taskState ?? null)}`,
    `Available skills: ${JSON.stringify(input.availableSkillIds)}`,
  ].join("\n");

  try {
    const result = await generateText({
      model: input.model,
      output: Output.object({
        schema: routeAdviceSchema,
        name: "AuthoringRouteAdvice",
        description: "Advisory authoring route decision.",
      }),
      providerOptions: input.providerOptions,
      ...(input.supportsTemperature ? { temperature: 0 } : {}),
      abortSignal: input.abortSignal,
      prompt,
    });

    return {
      ...result.output,
      recommendedSkillIds: result.output.recommendedSkillIds.filter((id) =>
        input.availableSkillIds.includes(id),
      ),
    };
  } catch {
    return fallback;
  }
}
