export type AuthMethod = "account" | "google";

export interface AuthSession {
  user_id: string;
  workspace_id: string;
  permissions: string[];
  expires_at: number;
}

interface ApiResponse<T> {
  status_code: number;
  reason: string;
  data: T | null;
}

async function readJson<T>(response: Response): Promise<ApiResponse<T>> {
  return (await response.json()) as ApiResponse<T>;
}

export async function readAuthSession(): Promise<AuthSession | null> {
  const response = await fetch("/api/auth/session", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error("AUTH_SESSION_LOAD_FAILED");
  }
  const payload = await readJson<AuthSession>(response);
  return payload.data;
}

export async function signIn(input: {
  method: AuthMethod;
  identity?: string;
  password?: string;
}): Promise<void> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error("AUTH_LOGIN_FAILED");
  }
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
}
