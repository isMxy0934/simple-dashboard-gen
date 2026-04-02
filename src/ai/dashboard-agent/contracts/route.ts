import { z } from "zod";

export const dashboardAgentRouteSchema = z.enum([
  "approval",
  "chat",
  "authoring",
]);

export const dashboardAgentRouteDecisionSchema = z.object({
  route: dashboardAgentRouteSchema,
  summary: z.string().min(1),
  user_goal: z.string().min(1),
  signals: z.array(z.string().min(1)).max(5),
});

export type DashboardAgentRouteDecision = z.infer<
  typeof dashboardAgentRouteDecisionSchema
>;
export type DashboardAgentRoute = z.infer<typeof dashboardAgentRouteSchema>;

export function summarizeDashboardAgentRouteDecision(
  routeDecision: DashboardAgentRouteDecision,
): string {
  return `${routeDecision.route}: ${routeDecision.summary}`;
}

export function buildDashboardAgentRouteDecision(input: {
  request: string;
  hasRecentAuthoringContext?: boolean;
  hasPendingProposal?: boolean;
}): DashboardAgentRouteDecision {
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

  if (isObviousSmallTalk(text) && !input.hasRecentAuthoringContext) {
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
