import type { AuthoringChatSessionPayload } from "@/ai/authoring/contracts/session-state";

interface AgentSessionResponse {
  status_code?: number;
  reason?: string;
  data?: {
    sessionId: string;
    payload: AuthoringChatSessionPayload;
  } | null;
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json()) as T;
}

export async function loadAuthoringAgentSession(
  input: {
    workspaceId: string;
    userId: string;
    dashboardId: string;
    sessionId: string;
  },
): Promise<AuthoringChatSessionPayload | null> {
  const response = await fetch(
    `/api/authoring/ui-session?workspaceId=${encodeURIComponent(input.workspaceId)}&userId=${encodeURIComponent(input.userId)}&dashboardId=${encodeURIComponent(input.dashboardId)}&sessionId=${encodeURIComponent(input.sessionId)}`,
    { cache: "no-store" },
  );
  const payload = await parseJsonResponse<AgentSessionResponse>(response);

  if (!response.ok || !payload || payload.status_code !== 200) {
    return null;
  }

  return payload.data?.payload ?? null;
}
