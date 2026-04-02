import type {
  ApiResponse,
  BindingResults,
  ExecuteBatchRequest,
  JsonValue,
} from "../../contracts";

export interface BatchClientResponse {
  status_code: number;
  reason: string;
  data: {
    binding_results: BindingResults;
  } | null;
}

const batchCache = new Map<string, Promise<BatchClientResponse>>();

export async function executeBatchCached(
  request: ExecuteBatchRequest,
  endpoint = "/api/query/execute-batch",
): Promise<BatchClientResponse> {
  const cacheKey = stableSerialize(request);
  const cached = batchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = executeBatchRequest(request, endpoint);

  batchCache.set(cacheKey, promise);

  promise.catch(() => {
    batchCache.delete(cacheKey);
  });

  return promise;
}

async function executeBatchRequest(
  request: ExecuteBatchRequest,
  endpoint: string,
): Promise<BatchClientResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`batch request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ApiResponse<{
    binding_results: BindingResults;
  }>;

  if (payload && typeof payload === "object" && payload.data && "binding_results" in payload.data) {
    return {
      status_code: payload.status_code ?? 200,
      reason: payload.reason ?? "OK",
      data: payload.data,
    };
  }

  if (payload && typeof payload === "object" && "binding_results" in payload) {
    return {
      status_code: 200,
      reason: "OK",
      data: {
        binding_results: (payload as { binding_results: BindingResults }).binding_results,
      },
    };
  }

  throw new Error("batch response did not include binding_results");
}

function stableSerialize(value: JsonValue | ExecuteBatchRequest): string {
  return JSON.stringify(value, (_, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.keys(entry)
        .sort()
        .reduce<Record<string, unknown>>((accumulator, key) => {
          accumulator[key] = (entry as Record<string, unknown>)[key];
          return accumulator;
        }, {});
    }

    return entry;
  });
}
