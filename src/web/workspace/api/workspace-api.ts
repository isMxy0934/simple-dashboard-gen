import type {
  WorkspaceContextPayload,
  WorkspaceUserSettings,
} from "@/contracts";
import type { AppLocale } from "../../i18n";

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
  requireWorkspaceId(workspaceId);
  const response = await fetch("/api/workspace/context", { cache: "no-store" });
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
  requireWorkspaceId(input.workspaceId);
  const response = await fetch("/api/authoring/settings", { cache: "no-store" });
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
    body: JSON.stringify({ verbose: input.verbose }),
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

export async function saveWorkspaceLocaleSetting(input: {
  workspaceId: string;
  userId: string;
  locale: AppLocale;
}): Promise<WorkspaceUserSettings> {
  const response = await fetch("/api/authoring/settings", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ locale: input.locale }),
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
