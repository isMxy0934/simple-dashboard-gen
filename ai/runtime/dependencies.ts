import type { BindingResults, PreviewRequest } from "../../contracts";

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

export interface DashboardAiDependencies {
  executePreview?: (
    request: PreviewRequest,
  ) => Promise<AiPreviewExecutionResult>;
  writeDebugLog?: (
    scope: string,
    event: string,
    payload?: unknown,
  ) => Promise<void> | void;
}

export async function writeAiDebugLog(
  dependencies: DashboardAiDependencies | undefined,
  scope: string,
  event: string,
  payload?: unknown,
) {
  await dependencies?.writeDebugLog?.(scope, event, payload);
}
