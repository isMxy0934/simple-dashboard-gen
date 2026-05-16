export type LocalAuthMethod = "account" | "google";

export interface LocalAuthSession {
  method: LocalAuthMethod;
  signedInAt: string;
}

const LOCAL_AUTH_STORAGE_KEY = "mercaso.reports.auth-session.v1";

function isLocalAuthSession(value: unknown): value is LocalAuthSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<LocalAuthSession>;
  return (
    (candidate.method === "account" || candidate.method === "google") &&
    typeof candidate.signedInAt === "string" &&
    candidate.signedInAt.trim().length > 0
  );
}

export function readLocalAuthSession(): LocalAuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(LOCAL_AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isLocalAuthSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLocalAuthSession(method: LocalAuthMethod) {
  if (typeof window === "undefined") {
    return;
  }

  const session: LocalAuthSession = {
    method,
    signedInAt: new Date().toISOString(),
  };
  window.localStorage.setItem(LOCAL_AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearLocalAuthSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(LOCAL_AUTH_STORAGE_KEY);
}
