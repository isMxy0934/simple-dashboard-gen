import "server-only";

import { ApiError } from "@/server/api-error";
import { observability } from "@/server/logs/observability";

interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

interface RateLimitBucket {
  resetAt: number;
  count: number;
}

declare global {
  var __sdsRateLimitBuckets: Map<string, RateLimitBucket> | undefined;
}

const DEFAULT_POLICY: RateLimitPolicy = {
  limit: 60,
  windowMs: 60_000,
};

const POLICIES: Record<string, RateLimitPolicy & { code: string; i18nKey: string }> = {
  "auth.login": {
    limit: 5,
    windowMs: 60_000,
    code: "RATE_LIMIT_LOGIN",
    i18nKey: "error.rate_limit.login",
  },
  "auth.refresh": {
    limit: 10,
    windowMs: 60_000,
    code: "RATE_LIMIT_AUTH",
    i18nKey: "error.rate_limit.auth",
  },
  "query": {
    limit: 60,
    windowMs: 60_000,
    code: "RATE_LIMIT_QUERY",
    i18nKey: "error.rate_limit.query",
  },
  "api.mutate": {
    limit: 300,
    windowMs: 60_000,
    code: "RATE_LIMIT_GENERIC",
    i18nKey: "error.rate_limit.generic",
  },
  "query.execute": {
    limit: 60,
    windowMs: 60_000,
    code: "RATE_LIMIT_QUERY",
    i18nKey: "error.rate_limit.query",
  },
  "agent.stream": {
    limit: 30,
    windowMs: 60_000,
    code: "RATE_LIMIT_AGENT",
    i18nKey: "error.rate_limit.agent",
  },
};

function buckets(): Map<string, RateLimitBucket> {
  if (!globalThis.__sdsRateLimitBuckets) {
    globalThis.__sdsRateLimitBuckets = new Map();
  }
  return globalThis.__sdsRateLimitBuckets;
}

export function getRateLimitPolicy(scope: string): RateLimitPolicy {
  return POLICIES[scope] ?? DEFAULT_POLICY;
}

function bucketId(scope: string, key: string): string {
  return `${scope}:${key}`;
}

export async function assertRateLimit(
  scope: string,
  key: string,
  context: {
    sessionId?: string | null;
    dashboardId?: string | null;
    turnId?: string | null;
    requestId?: string | null;
  } = {},
): Promise<void> {
  const normalizedScope = scope.trim();
  const normalizedKey = key.trim();
  if (!normalizedScope || !normalizedKey) {
    throw new ApiError(400, "INVALID_RATE_LIMIT_KEY", "error.rate_limit.invalid_key");
  }

  const now = Date.now();
  const policy = getRateLimitPolicy(normalizedScope);
  const id = bucketId(normalizedScope, normalizedKey);
  const store = buckets();
  const current = store.get(id);
  const bucket =
    current && current.resetAt > now
      ? current
      : {
          count: 0,
          resetAt: now + policy.windowMs,
        };

  bucket.count += 1;
  store.set(id, bucket);

  if (bucket.count > policy.limit) {
    const descriptor = POLICIES[normalizedScope] ?? {
      ...DEFAULT_POLICY,
      code: "RATE_LIMIT_GENERIC",
      i18nKey: "error.rate_limit.generic",
    };
    if (context.sessionId) {
      void observability.emit({
        type: "rate_limit.exceeded",
        level: "warn",
        sessionId: context.sessionId,
        dashboardId: context.dashboardId ?? null,
        turnId: context.turnId ?? null,
        requestId: context.requestId ?? "rate_limit",
        timestamp: new Date().toISOString(),
        payload: {
          scope: normalizedScope,
          key: normalizedKey,
          limit: policy.limit,
          current: bucket.count,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        },
        status: "errored",
      });
    }
    throw new ApiError(429, descriptor.code, descriptor.i18nKey, {
      scope: normalizedScope,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    });
  }
}

export function resetRateLimitBucketsForTests(): void {
  buckets().clear();
}
