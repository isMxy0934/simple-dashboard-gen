import "server-only";

import type { DashboardDocument } from "@/contracts";
import { ApiError } from "@/server/api-error";
import { observability } from "@/server/logs/observability";

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

interface QuotaDescriptor {
  code: string;
  i18nKey: string;
  scope: string;
}

const QUOTA_DESCRIPTORS: Record<QuotaKey, QuotaDescriptor> = {
  viewsPerDashboard: {
    code: "QUOTA_VIEWS_PER_DASHBOARD",
    i18nKey: "error.quota.views_per_dashboard",
    scope: "dashboard",
  },
  queriesPerDashboard: {
    code: "QUOTA_QUERIES_PER_DASHBOARD",
    i18nKey: "error.quota.queries_per_dashboard",
    scope: "dashboard",
  },
  documentSizeMb: {
    code: "QUOTA_DOCUMENT_SIZE",
    i18nKey: "error.quota.document_size",
    scope: "dashboard",
  },
  queryRows: {
    code: "QUOTA_QUERY_ROWS",
    i18nKey: "error.quota.query_rows",
    scope: "query",
  },
  queryBytes: {
    code: "QUOTA_QUERY_BYTES",
    i18nKey: "error.quota.query_bytes",
    scope: "query",
  },
  batchSize: {
    code: "QUOTA_BATCH_SIZE",
    i18nKey: "error.quota.batch_size",
    scope: "query",
  },
  modelInputTokens: {
    code: "QUOTA_MODEL_INPUT_TOKENS",
    i18nKey: "error.quota.model_input_tokens",
    scope: "agent",
  },
  modelOutputTokens: {
    code: "QUOTA_MODEL_OUTPUT_TOKENS",
    i18nKey: "error.quota.model_output_tokens",
    scope: "agent",
  },
  traceFileMb: {
    code: "QUOTA_TRACE_FILE",
    i18nKey: "error.quota.trace_file",
    scope: "trace",
  },
  sessionsPerWorkspace: {
    code: "QUOTA_SESSIONS_PER_WORKSPACE",
    i18nKey: "error.quota.sessions_per_workspace",
    scope: "workspace",
  },
  dashboardsPerWorkspace: {
    code: "QUOTA_DASHBOARDS_PER_WORKSPACE",
    i18nKey: "error.quota.dashboards_per_workspace",
    scope: "workspace",
  },
  storageGb: {
    code: "QUOTA_STORAGE_GB",
    i18nKey: "error.quota.storage_gb",
    scope: "workspace",
  },
};

export interface QuotaContext {
  sessionId?: string | null;
  dashboardId?: string | null;
  turnId?: string | null;
  requestId?: string | null;
  scopeId?: string | null;
}

const QUOTA_ENV: Record<QuotaKey, string> = {
  viewsPerDashboard: "SDS_QUOTA_VIEWS_PER_DASHBOARD",
  queriesPerDashboard: "SDS_QUOTA_QUERIES_PER_DASHBOARD",
  documentSizeMb: "SDS_QUOTA_DOCUMENT_SIZE_MB",
  queryRows: "SDS_QUOTA_QUERY_ROWS",
  queryBytes: "SDS_QUOTA_QUERY_BYTES",
  batchSize: "SDS_QUOTA_BATCH_SIZE",
  modelInputTokens: "SDS_QUOTA_MODEL_INPUT_TOKENS",
  modelOutputTokens: "SDS_QUOTA_MODEL_OUTPUT_TOKENS",
  traceFileMb: "SDS_QUOTA_TRACE_FILE_MB",
  sessionsPerWorkspace: "SDS_QUOTA_SESSIONS_PER_WORKSPACE",
  dashboardsPerWorkspace: "SDS_QUOTA_DASHBOARDS_PER_WORKSPACE",
  storageGb: "SDS_QUOTA_STORAGE_GB",
};

export function getQuotaLimit(key: QuotaKey): number {
  const raw = process.env[QUOTA_ENV[key]];
  if (raw === undefined || raw.trim() === "") {
    return QUOTAS[key];
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(500, "QUOTA_CONFIG_INVALID", "error.quota.config_invalid", {
      key,
    });
  }
  return parsed;
}

export async function assertQuota(
  key: QuotaKey,
  value: number,
  context: QuotaContext = {},
): Promise<void> {
  if (!Number.isFinite(value) || value < 0) {
    throw new ApiError(400, "INVALID_QUOTA_VALUE", "error.quota.invalid_value", {
      key,
      value,
    });
  }

  const limit = getQuotaLimit(key);
  const descriptor = QUOTA_DESCRIPTORS[key];
  if (value >= limit * 0.8 && context.sessionId) {
    void observability.emit({
      type: "quota.warning",
      level: "warn",
      sessionId: context.sessionId,
      dashboardId: context.dashboardId ?? null,
      turnId: context.turnId ?? null,
      requestId: context.requestId ?? "quota",
      timestamp: new Date().toISOString(),
      payload: {
        key,
        limit,
        current: value,
        scope: descriptor.scope,
        scope_id: context.scopeId ?? null,
      },
      status: "active",
    });
  }

  if (value > limit) {
    if (context.sessionId) {
      void observability.emit({
        type: "quota.exceeded",
        level: "warn",
        sessionId: context.sessionId,
        dashboardId: context.dashboardId ?? null,
        turnId: context.turnId ?? null,
        requestId: context.requestId ?? "quota",
        timestamp: new Date().toISOString(),
        payload: {
          key,
          limit,
          current: value,
          scope: descriptor.scope,
          scope_id: context.scopeId ?? null,
        },
        status: "errored",
      });
    }
    throw new ApiError(413, descriptor.code, descriptor.i18nKey, {
      key,
      current: value,
      limit,
      scope: descriptor.scope,
      scope_id: context.scopeId ?? null,
    });
  }
}

export async function assertDashboardDocumentQuota(
  document: DashboardDocument,
  context: QuotaContext = {},
): Promise<void> {
  const scopeId = context.scopeId ?? context.dashboardId ?? null;
  await assertQuota("viewsPerDashboard", document.dashboard_spec.views.length, {
    ...context,
    scopeId,
  });
  await assertQuota("queriesPerDashboard", document.query_defs.length, {
    ...context,
    scopeId,
  });
  await assertQuota(
    "documentSizeMb",
    Buffer.byteLength(JSON.stringify(document), "utf8") / 1_048_576,
    {
      ...context,
      scopeId,
    },
  );
}
