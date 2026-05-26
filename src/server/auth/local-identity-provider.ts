import "server-only";

import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";
import { getPgPool } from "@/server/datasource/postgres";
import type { NormalizedIdentity } from "./identity";
import { verifyLocalPassword } from "./password";

export interface QueryablePool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

interface VerifyLocalCredentialsInput {
  identity: unknown;
  password: unknown;
}

function normalizeCredentialInput(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolvePool(options?: { pool?: QueryablePool }): QueryablePool {
  return options?.pool ?? getPgPool();
}

async function ensureLocalCredentialStoreReady(options?: {
  pool?: QueryablePool;
}): Promise<void> {
  if (!options?.pool) {
    await ensureCloudAuthoringSchema();
  }
}

export async function verifyLocalCredentials(
  input: VerifyLocalCredentialsInput,
  options: { pool?: QueryablePool } = {},
): Promise<NormalizedIdentity | null> {
  const identity = normalizeCredentialInput(input.identity)?.toLowerCase();
  const password = normalizeCredentialInput(input.password);
  if (!identity || !password) {
    return null;
  }

  await ensureLocalCredentialStoreReady(options);
  const result = await resolvePool(options).query(
    `
      select
        ai.provider,
        ai.subject,
        ai.email,
        ai.display_name,
        luc.password_hash,
        luc.disabled_at
      from auth_identities ai
      join local_user_credentials luc
        on luc.provider = ai.provider
       and luc.subject = ai.subject
      where ai.provider = 'local'
        and (
          lower(ai.subject) = $1
          or lower(ai.email) = $1
        )
      limit 1
    `,
    [identity],
  );

  const row = result.rows[0];
  if (
    !row ||
    row.provider !== "local" ||
    typeof row.subject !== "string" ||
    typeof row.password_hash !== "string" ||
    row.disabled_at !== null
  ) {
    return null;
  }

  const passwordMatches = await verifyLocalPassword(password, row.password_hash);
  if (!passwordMatches) {
    return null;
  }

  return {
    provider: "local",
    subject: row.subject,
    email: optionalString(row.email),
    displayName: optionalString(row.display_name),
  };
}

