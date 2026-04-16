import type {
  EditingPresenceEntry,
  MainAgentSessionPayload,
  OpenSessionRequest,
  OpenSessionResponse,
  SaveSessionRequest,
  WorkspaceContextPayload,
  WorkspaceSettings,
} from "@/contracts";

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json()) as T;
}

export async function loadWorkspaceContext(
  workspaceId = "ws_default",
): Promise<WorkspaceContextPayload> {
  const response = await fetch(
    `/api/workspace/context?workspaceId=${encodeURIComponent(workspaceId)}`,
    { cache: "no-store" },
  );
  const payload = await parseJsonResponse<{
    status_code?: number;
    reason?: string;
    data?: WorkspaceContextPayload | null;
  }>(response);

  if (!response.ok || payload?.status_code !== 200 || !payload.data) {
    throw new Error(payload?.reason || "Unable to load workspace context.");
  }

  return payload.data;
}

export async function loadMainAgentSettings(
  workspaceId: string,
): Promise<WorkspaceSettings> {
  const response = await fetch(
    `/api/main-agent/settings?workspaceId=${encodeURIComponent(workspaceId)}`,
    { cache: "no-store" },
  );
  const payload = await parseJsonResponse<{
    status_code?: number;
    reason?: string;
    data?: WorkspaceSettings | null;
  }>(response);

  if (!response.ok || payload?.status_code !== 200 || !payload.data) {
    throw new Error(payload?.reason || "Unable to load main agent settings.");
  }

  return payload.data;
}

export async function saveMainAgentVerboseSetting(input: {
  workspaceId: string;
  verbose: boolean;
}): Promise<WorkspaceSettings> {
  const response = await fetch("/api/main-agent/settings", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await parseJsonResponse<{
    status_code?: number;
    reason?: string;
    data?: WorkspaceSettings | null;
  }>(response);

  if (!response.ok || payload?.status_code !== 200 || !payload.data) {
    throw new Error(payload?.reason || "Unable to save main agent settings.");
  }

  return payload.data;
}

export async function openMainAgentSession(
  input: OpenSessionRequest,
): Promise<OpenSessionResponse> {
  const response = await fetch("/api/main-agent/session/open", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await parseJsonResponse<{
    status_code?: number;
    reason?: string;
    data?: OpenSessionResponse | null;
  }>(response);

  if (!response.ok || payload?.status_code !== 200 || !payload.data) {
    throw new Error(payload?.reason || "Unable to open main agent session.");
  }

  return payload.data;
}

export async function saveMainAgentSession(
  input: SaveSessionRequest,
): Promise<MainAgentSessionPayload> {
  const response = await fetch("/api/main-agent/session/save", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await parseJsonResponse<{
    status_code?: number;
    reason?: string;
    data?: MainAgentSessionPayload | null;
  }>(response);

  if (!response.ok || payload?.status_code !== 200 || !payload.data) {
    throw new Error(payload?.reason || "Unable to save main agent session.");
  }

  return payload.data;
}

export async function loadEditingPresence(input: {
  workspaceId: string;
  dashboardId: string;
}): Promise<EditingPresenceEntry[]> {
  const response = await fetch(
    `/api/workspace/presence?workspaceId=${encodeURIComponent(input.workspaceId)}&dashboardId=${encodeURIComponent(input.dashboardId)}`,
    { cache: "no-store" },
  );
  const payload = await parseJsonResponse<{
    status_code?: number;
    reason?: string;
    data?: {
      presence?: EditingPresenceEntry[];
    } | null;
  }>(response);

  if (!response.ok || payload?.status_code !== 200 || !payload.data?.presence) {
    throw new Error(payload?.reason || "Unable to load editing presence.");
  }

  return payload.data.presence;
}
