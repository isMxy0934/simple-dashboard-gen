import type { MainAgentChatSessionPayload } from "@/ai/main-agent/contracts/session-state";

interface AgentSessionResponse {
  status_code?: number;
  reason?: string;
  data?: {
    sessionId: string;
    payload: MainAgentChatSessionPayload;
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
): Promise<MainAgentChatSessionPayload | null> {
  const response = await fetch(
    `/api/main-agent/ui-session?workspaceId=${encodeURIComponent(input.workspaceId)}&userId=${encodeURIComponent(input.userId)}&dashboardId=${encodeURIComponent(input.dashboardId)}&sessionId=${encodeURIComponent(input.sessionId)}`,
    { cache: "no-store" },
  );
  const payload = await parseJsonResponse<AgentSessionResponse>(response);

  if (!response.ok || !payload || payload.status_code !== 200) {
    return null;
  }

  return payload.data?.payload ?? null;
}

export async function persistAuthoringAgentSession(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
  dashboardId: string;
  payload: MainAgentChatSessionPayload;
}): Promise<void> {
  const response = await fetch("/api/main-agent/ui-session", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await parseJsonResponse<{
    status_code?: number;
    reason?: string;
  }>(response);

  if (!response.ok || !payload || payload.status_code !== 200) {
    throw new Error(payload?.reason || "Unable to persist agent session.");
  }
}
