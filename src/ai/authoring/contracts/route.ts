export type AuthoringRoute = "approval" | "chat" | "authoring";

export interface AuthoringRouteDecision {
  route: AuthoringRoute;
  summary: string;
  user_goal: string;
  signals: string[];
}
