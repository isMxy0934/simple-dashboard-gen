import { z } from "zod";

export const mainAgentRouteSchema = z.enum([
  "approval",
  "chat",
  "authoring",
]);

export const mainAgentRouteDecisionSchema = z.object({
  route: mainAgentRouteSchema,
  summary: z.string().min(1),
  user_goal: z.string().min(1),
  signals: z.array(z.string().min(1)).max(5),
});

export type MainAgentRouteDecision = z.infer<
  typeof mainAgentRouteDecisionSchema
>;
export type MainAgentRoute = z.infer<typeof mainAgentRouteSchema>;

export function summarizeMainAgentRouteDecision(
  routeDecision: MainAgentRouteDecision,
): string {
  return `${routeDecision.route}: ${routeDecision.summary}`;
}

export function buildMainAgentRouteDecision(input: {
  request: string;
  hasRecentAuthoringContext?: boolean;
  hasPendingProposal?: boolean;
}): MainAgentRouteDecision {
  const text = input.request.trim();

  if (input.hasPendingProposal) {
    return {
      route: "approval",
      summary:
        "A staged dashboard proposal is still pending approval, so this turn stays in the approval flow.",
      user_goal: text || "Resolve the staged dashboard proposal.",
      signals: ["pending-proposal"],
    };
  }

  if (isCapabilityQuestion(text)) {
    return {
      route: "chat",
      summary:
        "The user is asking about the agent's capabilities, so this turn should stay in conversation mode.",
      user_goal: text || "Explain the dashboard agent capabilities.",
      signals: ["capabilities-question"],
    };
  }

  if (isObviousSmallTalk(text)) {
    return {
      route: "chat",
      summary:
        "The user message is casual conversation and does not need the dashboard authoring loop.",
      user_goal: text || "Continue the conversation.",
      signals: ["small-talk"],
    };
  }

  return {
    route: "authoring",
    summary:
      input.hasRecentAuthoringContext
        ? "The user is continuing or refining a dashboard authoring task."
        : "The user turn should enter the dashboard authoring loop.",
    user_goal: text || "Continue dashboard authoring.",
    signals: input.hasRecentAuthoringContext
      ? ["recent-authoring-context"]
      : ["default-authoring-route"],
  };
}

export function isObviousSmallTalk(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed) {
    return false;
  }

  return /^(hi|hello|hey|yo|halo|howdy|good (morning|afternoon|evening)|你好|您好|哈喽|嗨|在吗|有人吗|早上好|下午好|晚上好|thanks|thank you|谢谢|好的|ok|okay)[!.。！?？ ]*$/i
    .test(trimmed);
}

function isCapabilityQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  return /(what can you do|what do you do|how can you help|help me with|你可以做什么|你能做什么|你会做什么|你能帮我什么|你可以帮我什么)/i
    .test(trimmed);
}
