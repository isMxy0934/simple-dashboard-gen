import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  ApplyPatchToolOutput,
  AuthoringApprovalEvent,
  AuthoringDraftOutput,
  DeclareAuthoringGoalToolInput,
  DeclareAuthoringGoalToolOutput,
  DraftStatusToolOutput,
  GetTableSchemaToolOutput,
  LoadSkillToolOutput,
  RunCheckToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import { stripProviderRuntimeMetadata } from "@/ai/authoring/runtime/llm-boundary";
import {
  findLatestApplyPatchOutputFromTranscript,
  findLatestDraftOutputFromTranscript,
} from "@/ai/authoring/runtime/transcript-inspection";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolResultMessage(message: AgentMessage): message is ToolResultMessage {
  return message.role === "toolResult";
}

function latestToolDetails<T>(
  messages: AgentMessage[],
  toolName: string,
  predicate: (details: unknown) => details is T,
): T | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isToolResultMessage(message) || message.toolName !== toolName) {
      continue;
    }
    const details = stripProviderRuntimeMetadata(message.details);
    if (predicate(details)) {
      return details;
    }
  }
  return null;
}

function latestToolDetailsList<T>(
  messages: AgentMessage[],
  toolName: string,
  predicate: (details: unknown) => details is T,
  limit = 8,
): T[] {
  const out: T[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isToolResultMessage(message) || message.toolName !== toolName) {
      continue;
    }
    const details = stripProviderRuntimeMetadata(message.details);
    if (predicate(details)) {
      out.push(details);
      if (out.length >= limit) {
        break;
      }
    }
  }
  return out;
}

function isDeclareGoalOutput(
  value: unknown,
): value is DeclareAuthoringGoalToolOutput {
  return (
    isRecord(value) &&
    typeof value.accepted === "boolean" &&
    typeof value.declaredIntentKind === "string" &&
    typeof value.message === "string"
  );
}

function isTableSchemaOutput(value: unknown): value is GetTableSchemaToolOutput {
  return (
    isRecord(value) &&
    typeof value.datasource_id === "string" &&
    isRecord(value.table) &&
    typeof value.table.name === "string" &&
    Array.isArray(value.fields)
  );
}

function isLoadSkillOutput(value: unknown): value is LoadSkillToolOutput {
  return (
    isRecord(value) &&
    typeof value.skill_id === "string" &&
    typeof value.content === "string"
  );
}

function isRunCheckOutput(value: unknown): value is RunCheckToolOutput {
  return (
    isRecord(value) &&
    (value.status === "ok" || value.status === "warning" || value.status === "error") &&
    typeof value.reason === "string"
  );
}

function declaredGoalSummary(
  declaration: DeclareAuthoringGoalToolInput | undefined,
): string | null {
  if (!declaration || declaration.kind === "set_data_mode") {
    return null;
  }
  return declaration.goal.summary ?? declaration.reason ?? null;
}

export interface AuthoringDerivedFacts {
  latestGoal: {
    accepted: boolean;
    kind: DeclareAuthoringGoalToolInput["kind"];
    activeGoalId: string | null;
    summary: string | null;
    declaration: DeclareAuthoringGoalToolInput | null;
  } | null;
  loadedTableSchemas: Array<{
    datasourceId: string;
    table: string;
    fieldCount: number;
    fields: Array<{
      name: string;
      qualifiedName: string;
      type: string;
      semanticType?: string;
      description?: string;
      comment?: string;
    }>;
  }>;
  loadedSkills: Array<{
    skillId: string;
  }>;
  draft: {
    hasDraft: boolean;
    canCompose: boolean;
    documentHash: string | null;
    dirtyViewIds: string[];
    dirtyQueryIds: string[];
    dirtyBindingIds: string[];
    blockers: DraftStatusToolOutput["blockers"];
  } | null;
  latestCheck: {
    status: RunCheckToolOutput["status"];
    reason: string;
    failureCount: number;
  } | null;
  pendingProposal: {
    proposalId: string;
    baseVersion: number | null;
    draftFingerprint: string | null;
    summary: string;
    operationCount: number;
  } | null;
  latestApply: ApplyPatchToolOutput | null;
  approval: {
    decision: AuthoringApprovalEvent["decision"];
    proposalId: string | null;
    baseVersion: number | null;
    matchesPendingProposal: boolean;
  } | null;
}

export function deriveAuthoringFacts(input: {
  messages: AgentMessage[];
  draftStatus?: DraftStatusToolOutput | null;
  approvalEvent?: AuthoringApprovalEvent | null;
}): AuthoringDerivedFacts {
  const latestGoalOutput = latestToolDetails(
    input.messages,
    "declareAuthoringGoal",
    isDeclareGoalOutput,
  );
  const loadedTableSchemas = latestToolDetailsList(
    input.messages,
    "getTableSchema",
    isTableSchemaOutput,
  ).map((schema) => ({
    datasourceId: schema.datasource_id,
    table: schema.table.name,
    fieldCount: schema.field_count,
    fields: schema.fields.map((field) => ({
      name: field.name,
      qualifiedName: field.qualified_name,
      type: field.standard_type,
      ...(field.semantic_type ? { semanticType: field.semantic_type } : {}),
      ...(field.description ? { description: field.description } : {}),
      ...(field.comment ? { comment: field.comment } : {}),
    })),
  }));
  const loadedSkills = latestToolDetailsList(
    input.messages,
    "loadSkill",
    isLoadSkillOutput,
  ).map((skill) => ({ skillId: skill.skill_id }));
  const latestCheck = latestToolDetails(
    input.messages,
    "runCheck",
    isRunCheckOutput,
  );
  const latestDraft = findLatestDraftOutputFromTranscript(input.messages);
  const latestApply = findLatestApplyPatchOutputFromTranscript(input.messages);
  const proposal = latestDraft
    ? {
        proposalId: latestDraft.suggestion.id,
        baseVersion:
          typeof latestDraft.base_version === "number"
            ? latestDraft.base_version
            : null,
        draftFingerprint: latestDraft.draft_fingerprint ?? null,
        summary: latestDraft.suggestion.summary,
        operationCount: latestDraft.suggestion.patch.operations.length,
      }
    : null;
  const approval = input.approvalEvent
    ? {
        decision: input.approvalEvent.decision,
        proposalId: input.approvalEvent.proposalId ?? null,
        baseVersion: input.approvalEvent.baseVersion ?? null,
        matchesPendingProposal:
          Boolean(proposal) &&
          input.approvalEvent.proposalId === proposal?.proposalId &&
          input.approvalEvent.baseVersion === proposal?.baseVersion,
      }
    : null;

  return {
    latestGoal: latestGoalOutput
      ? {
          accepted: latestGoalOutput.accepted,
          kind: latestGoalOutput.declaredIntentKind,
          activeGoalId: latestGoalOutput.activeGoalId ?? null,
          summary: declaredGoalSummary(latestGoalOutput.declaration),
          declaration: latestGoalOutput.declaration ?? null,
        }
      : null,
    loadedTableSchemas,
    loadedSkills,
    draft: input.draftStatus
      ? {
          hasDraft: input.draftStatus.has_draft,
          canCompose: input.draftStatus.can_compose,
          documentHash: input.draftStatus.document_hash,
          dirtyViewIds: input.draftStatus.dirty_view_ids,
          dirtyQueryIds: input.draftStatus.dirty_query_ids,
          dirtyBindingIds: input.draftStatus.dirty_binding_ids,
          blockers: input.draftStatus.blockers,
        }
      : null,
    latestCheck: latestCheck
      ? {
          status: latestCheck.status,
          reason: latestCheck.reason,
          failureCount: latestCheck.failures.length,
        }
      : null,
    pendingProposal: proposal,
    latestApply,
    approval,
  };
}
