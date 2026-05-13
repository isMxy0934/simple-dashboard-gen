import { Type } from "typebox";
import type { DashboardDocument, QueryDef } from "@/contracts";
import type {
  DraftStatusToolOutput,
  StageQueryToolInput,
  StageQueryToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import { AuthoringToolGateError } from "@/ai/authoring/contracts/errors";
import { defineTool } from "@/ai/authoring/tools/definition";
import { upsertQueryInDocument } from "@/domain/dashboard/document";
import {
  cloneQuery,
  type WorkingDraftState,
} from "@/ai/authoring/tools/draft-state";
import {
  buildCandidateDocument,
} from "@/ai/authoring/tools/candidate-document";

const STAGE_QUERY_TOOL_DESCRIPTION = [
  "Modify the SQL of an existing query in the working draft.",
  "Use this to change aggregation logic, joins, grouping, ordering, limits, or filter conditions while preserving the existing output schema.",
  "Only the sql field is updated; datasource_id, params, output schema, and other query metadata are preserved.",
  "Do not add, remove, or rename result columns with stageQuery. Schema changes must update QueryDef.output and pass runCheck in a separate flow.",
  "After stageQuery, call runCheck → composePatch before applying the staged SQL.",
  "Do not use this to change which datasource a query uses.",
].join(" ");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSqlTemplateParams(sqlTemplate: string): string[] {
  const matches = sqlTemplate.matchAll(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g);
  return [...new Set(Array.from(matches, (match) => match[1]))];
}

function sqlContainsWildcardOutput(sql: string): boolean {
  return /\bselect\s+(?:distinct\s+)?\*[\s,]/i.test(sql) || /(?:^|[\s,])\w+\.\*[\s,]/i.test(sql);
}

function sqlContainsOutputField(sql: string, fieldName: string): boolean {
  const field = escapeRegExp(fieldName);
  const quotedIdentifier = `(?:"${field}"|\`${field}\`|\\[${field}\\]|${field})`;
  return (
    new RegExp(`\\bas\\s+${quotedIdentifier}(?![a-zA-Z0-9_])`, "i").test(sql) ||
    new RegExp(`(?:^|[\\s,(])${quotedIdentifier}(?:\\s*(?:,|\\)|$)|\\s+from\\b|\\s+as\\b)`, "i").test(sql)
  );
}

export function validateStageQuerySqlCompatibility(
  query: QueryDef,
  sql: string,
): void {
  const declaredParams = new Set(query.params.map((param) => param.name));
  const undeclaredParams = getSqlTemplateParams(sql).filter(
    (param) => !declaredParams.has(param),
  );
  if (undeclaredParams.length > 0) {
    throw new AuthoringToolGateError({
      code: "schema_mismatch",
      userSafeSummary: `SQL references undeclared params: ${undeclaredParams.join(", ")}.`,
      recoveryHint: "Keep stageQuery limited to SQL changes that use the existing query params.",
      retryable: false,
    });
  }

  if (query.output.kind !== "rows" && query.output.kind !== "object") {
    return;
  }

  if (sqlContainsWildcardOutput(sql)) {
    throw new AuthoringToolGateError({
      code: "output_schema_mismatch",
      userSafeSummary: "stageQuery cannot verify wildcard SELECT output against the existing QueryDef.output schema.",
      recoveryHint: "Select the existing output fields explicitly, or use a schema-change flow that updates QueryDef.output.",
      retryable: false,
    });
  }

  const missingFields = query.output.schema
    .map((field) => field.name)
    .filter((fieldName) => !sqlContainsOutputField(sql, fieldName));
  if (missingFields.length > 0) {
    throw new AuthoringToolGateError({
      code: "output_schema_mismatch",
      userSafeSummary: `SQL output no longer matches QueryDef.output. Missing fields: ${missingFields.join(", ")}.`,
      recoveryHint: "Keep the existing output field names, or update the output contract and rerun checks in a schema-change flow.",
      retryable: false,
    });
  }
}

export function buildStageQueryTool(input: {
  dashboard: DashboardDocument;
  focusedViewId: string | null;
  workingDraft: WorkingDraftState;
  markWorkingDraftUpdated: () => void;
  buildDraftStatus: () => DraftStatusToolOutput;
}) {
  return defineTool({
    name: "stageQuery",
    label: "Stage Query",
    description: STAGE_QUERY_TOOL_DESCRIPTION,
    contract: {
      parameters: [
        "Provide query_id of an existing query, the full new SQL string, and a reason explaining the change.",
      ],
      prohibited: [
        "Do not use stageQuery to change datasource_id or any field other than sql.",
      ],
      preconditions: [
        "Call getQuery first to read the current SQL before writing a new one.",
      ],
    },
    parameters: Type.Object(
      {
        query_id: Type.String({ minLength: 1 }),
        sql: Type.String({ minLength: 1 }),
        reason: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential" as const,
    execute: async (toolInput: StageQueryToolInput): Promise<StageQueryToolOutput> => {
      const document = buildCandidateDocument(input.dashboard, input.workingDraft);

      const existingQuery = document.query_defs.find((q) => q.id === toolInput.query_id);
      if (!existingQuery) {
        throw new AuthoringToolGateError({
          code: "schema_mismatch",
          userSafeSummary: `Query "${toolInput.query_id}" was not found in the current document.`,
          recoveryHint: "Call getViews or getQuery to list valid query ids before calling stageQuery.",
          retryable: false,
        });
      }

      if (input.focusedViewId) {
        const queryOwnedByFocusedView = document.bindings.some(
          (binding) =>
            binding.query_id === toolInput.query_id &&
            binding.view_id === input.focusedViewId,
        );
        const queryUsedByOtherView = document.bindings.some(
          (binding) =>
            binding.query_id === toolInput.query_id &&
            binding.view_id !== input.focusedViewId,
        );
        if (!queryOwnedByFocusedView) {
          throw new AuthoringToolGateError({
            code: "scope_violation",
            userSafeSummary: `Query "${toolInput.query_id}" is not associated with the focused view "${input.focusedViewId}".`,
            recoveryHint: "Use a query that belongs to the focused view, or clear the selected card for dashboard-level edits.",
            retryable: false,
          });
        }
        if (queryUsedByOtherView) {
          throw new AuthoringToolGateError({
            code: "scope_violation",
            userSafeSummary: `Query "${toolInput.query_id}" is shared by other views; modifying it while focused on "${input.focusedViewId}" is not allowed.`,
            recoveryHint: "Clear the selected card to edit a shared query at dashboard scope.",
            retryable: false,
          });
        }
      }

      validateStageQuerySqlCompatibility(existingQuery, toolInput.sql);

      const updatedQuery = { ...existingQuery, sql_template: toolInput.sql };
      const nextDocument = upsertQueryInDocument(document, updatedQuery);

      input.workingDraft.queryDefs = nextDocument.query_defs.map(cloneQuery);
      input.workingDraft.dirtyQueryIds.add(toolInput.query_id);
      input.markWorkingDraftUpdated();

      const sqlPreview =
        toolInput.sql.length > 120
          ? toolInput.sql.slice(0, 120) + "…"
          : toolInput.sql;

      const draftStatus = input.buildDraftStatus();

      return {
        summary: `Staged SQL update for query "${toolInput.query_id}". Reason: ${toolInput.reason}`,
        stage: "staged",
        query_id: toolInput.query_id,
        sql_preview: sqlPreview,
        draft_status: draftStatus,
      };
    },
  });
}
