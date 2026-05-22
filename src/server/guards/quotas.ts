import "server-only";

export const QUOTAS = {
  viewsPerDashboard: 50,
  queriesPerDashboard: 100,
  documentSizeMb: 2,
  queryRows: 10_000,
  queryBytes: 5_242_880,
  batchSize: 20,
  modelInputTokens: 32_000,
  modelOutputTokens: 8_000,
  traceFileMb: 50,
  sessionsPerWorkspace: 50,
  dashboardsPerWorkspace: 200,
  storageGb: 10,
} as const;

export type QuotaKey = keyof typeof QUOTAS;

export async function assertQuota(_key: QuotaKey, _value: number): Promise<void> {
  throw new Error("NOT_IMPLEMENTED: assertQuota");
}
