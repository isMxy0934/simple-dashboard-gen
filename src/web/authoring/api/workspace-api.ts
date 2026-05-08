import type {
  EditingPresenceEntry,
  AuthoringSessionPayload,
  OpenSessionRequest,
  OpenSessionResponse,
  SaveSessionRequest,
  WorkspaceContextPayload,
  WorkspaceUserSettings,
} from "@/contracts";

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json()) as T;
}

function requireWorkspaceId(workspaceId: string): string {
  const trimmed = workspaceId.trim();
  if (!trimmed) {
    throw new Error("Workspace id is required.");
  }
  return trimmed;
}

export async function loadWorkspaceContext(
  workspaceId: string,
): Promise<WorkspaceContextPayload> {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);
  const response = await fetch(
    `/api/workspace/context?workspaceId=${encodeURIComponent(resolvedWorkspaceId)}`,
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

export async function loadAuthoringSettings(
  input: {
    workspaceId: string;
    userId: string;
  },
): Promise<WorkspaceUserSettings> {
  const response = await fetch(
    `/api/authoring/settings?workspaceId=${encodeURIComponent(input.workspaceId)}&userId=${encodeURIComponent(input.userId)}`,
    { cache: "no-store" },
  );
  const payload = await parseJsonResponse<{
    status_code?: number;
    reason?: string;
    data?: WorkspaceUserSettings | null;
  }>(response);

  if (!response.ok || payload?.status_code !== 200 || !payload.data) {
    throw new Error(payload?.reason || "Unable to load main agent settings.");
  }

  return payload.data;
}

export async function saveAuthoringVerboseSetting(input: {
  workspaceId: string;
  userId: string;
  verbose: boolean;
}): Promise<WorkspaceUserSettings> {
  const response = await fetch("/api/authoring/settings", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await parseJsonResponse<{
    status_code?: number;
    reason?: string;
    data?: WorkspaceUserSettings | null;
  }>(response);

  if (!response.ok || payload?.status_code !== 200 || !payload.data) {
    throw new Error(payload?.reason || "Unable to save main agent settings.");
  }

  return payload.data;
}

export async function openAuthoringSession(
  input: OpenSessionRequest,
): Promise<OpenSessionResponse> {
  const response = await fetch("/api/authoring/session/open", {
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

export async function saveAuthoringSession(
  input: SaveSessionRequest,
): Promise<AuthoringSessionPayload> {
  const response = await fetch("/api/authoring/session/save", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await parseJsonResponse<{
    status_code?: number;
    reason?: string;
    data?: AuthoringSessionPayload | null;
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
