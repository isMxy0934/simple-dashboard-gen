import { Type } from "typebox";
import type { DashboardDocument } from "@/contracts";
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
  "Use this to add computed columns, change aggregation logic, or update filter conditions.",
  "Only the sql field is updated; datasource_id, output schema, and other query metadata are preserved.",
  "After stageQuery, call stageChart to re-bind chart fields to the updated columns, then runCheck → composePatch.",
  "Do not use this to change which datasource a query uses.",
].join(" ");

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
