import type {
  WorkspaceContextPayload,
  WorkspaceUserSettings,
} from "@/contracts";
import { DEFAULT_WORKSPACE_ID } from "@/shared/workspace-defaults";

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json()) as T;
}

export async function loadWorkspaceContext(
  workspaceId = DEFAULT_WORKSPACE_ID,
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

export async function loadWorkspaceUserSettings(input: {
  workspaceId: string;
  userId: string;
}): Promise<WorkspaceUserSettings> {
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
    throw new Error(payload?.reason || "Unable to load workspace user settings.");
  }

  return payload.data;
}

export async function saveWorkspaceVerboseSetting(input: {
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
    throw new Error(payload?.reason || "Unable to save workspace user settings.");
  }

  return payload.data;
}
