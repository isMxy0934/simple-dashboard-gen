import type { BindingResults, PreviewRequest, DatasourceContext } from "@/contracts";
import type { DatasourceListItemSummary } from "@/agent/dashboard-agent/contracts/agent-contract";
import type { RendererChecksByView } from "@/renderers/core/validation-result";

export interface AiPreviewExecutionResult {
  httpStatus: number;
  body: {
    status_code: number;
    reason: string;
    data: {
      binding_results: BindingResults;
      renderer_checks: RendererChecksByView;
    } | null;
  };
}

export interface DashboardAgentDependencies {
  executePreview?: (
    request: PreviewRequest,
  ) => Promise<AiPreviewExecutionResult>;
  listDatasources?: () => Promise<DatasourceListItemSummary[]>;
  loadDatasourceSchema?: (datasourceId: string) => Promise<DatasourceContext>;
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
