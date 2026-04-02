import type { BindingResults, PreviewRequest } from "@/contracts";

export interface AiPreviewExecutionResult {
  httpStatus: number;
  body: {
    status_code: number;
    reason: string;
    data: {
      binding_results: BindingResults;
    } | null;
  };
}

export interface DashboardAgentDependencies {
  executePreview?: (
    request: PreviewRequest,
  ) => Promise<AiPreviewExecutionResult>;
  writeTraceEvent?: (input: {
    scope: string;
    event: string;
    payload?: unknown;
  }) => Promise<void> | void;
}

export async function writeDashboardAgentTrace(
  dependencies: DashboardAgentDependencies | undefined,
  scope: string,
  event: string,
  payload?: unknown,
) {
  await dependencies?.writeTraceEvent?.({
    scope,
    event,
    payload,
  });
}
