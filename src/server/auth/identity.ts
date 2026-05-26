import type { Permission } from "./permissions";

export type AuthProvider = "local" | "auth0";

export interface NormalizedIdentity {
  provider: AuthProvider;
  subject: string;
  email: string | null;
  displayName: string | null;
}

export interface ResolvedAppUser {
  workspaceId: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  permissions: Permission[];
}

