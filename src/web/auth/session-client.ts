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
  message_i18n_key?: string;
  data: T | null;
}

export class AuthLoginError extends Error {
  readonly status: number;
  readonly reason: string;
  readonly messageI18nKey: string | undefined;

  constructor(input: {
    status: number;
    reason: string;
    messageI18nKey?: string;
  }) {
    super(input.reason);
    this.name = "AuthLoginError";
    this.status = input.status;
    this.reason = input.reason;
    this.messageI18nKey = input.messageI18nKey;
  }
}

async function readJson<T>(response: Response): Promise<ApiResponse<T>> {
  return (await response.json()) as ApiResponse<T>;
}

async function tryReadJson<T>(response: Response): Promise<ApiResponse<T> | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  try {
    return await readJson<T>(response);
  } catch {
    return null;
  }
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
    const payload = await tryReadJson<null>(response);
    throw new AuthLoginError({
      status: response.status,
      reason: payload?.reason ?? "AUTH_LOGIN_FAILED",
      messageI18nKey: payload?.message_i18n_key,
    });
  }
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
}
