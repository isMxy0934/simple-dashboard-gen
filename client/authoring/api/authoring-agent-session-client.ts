import type { PersistedAuthoringAgentSessionPayload } from "../../../ai/runtime/agent-session-state";

interface AgentSessionResponse {
  status_code?: number;
  reason?: string;
  data?: {
    sessionKey: string;
    payload: PersistedAuthoringAgentSessionPayload;
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
  sessionKey: string,
): Promise<PersistedAuthoringAgentSessionPayload | null> {
  const response = await fetch(
    `/api/agent/session?sessionKey=${encodeURIComponent(sessionKey)}`,
    { cache: "no-store" },
  );
  const payload = await parseJsonResponse<AgentSessionResponse>(response);

  if (!response.ok || !payload || payload.status_code !== 200) {
    return null;
  }

  return payload.data?.payload ?? null;
}

export async function persistAuthoringAgentSession(input: {
  sessionKey: string;
  payload: PersistedAuthoringAgentSessionPayload;
}): Promise<void> {
  const response = await fetch("/api/agent/session", {
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
