import type { BindingResults, PreviewRequest, DatasourceContext } from "@/contracts";
import type {
  DatasourceListItemSummary,
  LoadSkillToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringAgentLedgerEvent } from "@/ai/authoring/agent/ledger";
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

export interface AuthoringDependencies {
  executePreview: (
    request: PreviewRequest,
  ) => Promise<AiPreviewExecutionResult>;
  listDatasources: () => Promise<DatasourceListItemSummary[]>;
  loadDatasourceSchema: (datasourceId: string) => Promise<DatasourceContext>;
  loadSkill: (skillName: string) => Promise<LoadSkillToolOutput | null>;
  writeTraceEvent?: (input: {
    scope: string;
    event: string;
    payload?: unknown;
  }) => Promise<void> | void;
  writeLedgerEvent?: (event: AuthoringAgentLedgerEvent) => Promise<void> | void;
}

export async function writeAuthoringTrace(
  dependencies: AuthoringDependencies | undefined,
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

export async function writeAuthoringLedgerEvent(
  dependencies: AuthoringDependencies | undefined,
  event: AuthoringAgentLedgerEvent,
) {
  await dependencies?.writeLedgerEvent?.(event);
}

export function createValidationOnlyAuthoringDependencies(): AuthoringDependencies {
  const fail = async (name: string) => {
    throw new Error(`Authoring dependency "${name}" is not available in validation mode.`);
  };

  return {
    executePreview: async () => fail("executePreview"),
    listDatasources: async () => fail("listDatasources"),
    loadDatasourceSchema: async () => fail("loadDatasourceSchema"),
    loadSkill: async () => fail("loadSkill"),
  };
}
