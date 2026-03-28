import { z } from "zod";

export const authoringRouteSchema = z.enum([
  "approval",
  "chat",
  "authoring",
]);

export const authoringRouteDecisionSchema = z.object({
  route: authoringRouteSchema,
  summary: z.string().min(1),
  user_goal: z.string().min(1),
  signals: z.array(z.string().min(1)).max(5),
});

export type AuthoringRouteDecision = z.infer<typeof authoringRouteDecisionSchema>;
export type AuthoringRoute = z.infer<typeof authoringRouteSchema>;

export function summarizeAuthoringRouteDecision(
  routeDecision: AuthoringRouteDecision,
): string {
  return `${routeDecision.route}: ${routeDecision.summary}`;
}

export function buildAuthoringRouteDecision(input: {
  request: string;
  hasRecentAuthoringContext?: boolean;
  hasPendingProposal?: boolean;
}): AuthoringRouteDecision {
  const text = input.request.trim();
  const normalized = text.toLowerCase();

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
    user_goal:
      text ||
      (normalized ? normalized : "Continue dashboard authoring."),
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
