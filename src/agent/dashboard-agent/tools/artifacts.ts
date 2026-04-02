import type {
  DashboardDocument,
  DatasourceContext,
} from "@/contracts";

export type AiSuggestionKind = "layout" | "data";

export interface ContractPatchOperation {
  op: "add" | "update" | "remove" | "upsert";
  path: string;
  summary: string;
}

export interface ContractPatch {
  summary: string;
  operations: ContractPatchOperation[];
}

export interface AiSuggestion {
  id: string;
  kind: AiSuggestionKind;
  title: string;
  summary: string;
  details: string[];
  patch: ContractPatch;
  /** Full candidate document; omitted after prune/redact to keep chat payloads small. */
  dashboard?: DashboardDocument;
}

export interface GenerateDataInput {
  prompt: string;
  currentDocument: DashboardDocument;
  datasourceSchema?: DatasourceContext | null;
}
