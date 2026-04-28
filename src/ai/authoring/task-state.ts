import type {
  AuthoringTaskStateSnapshot,
  AuthoringToolFailureSnapshot,
} from "@/ai/authoring/contracts/session-state";
import {
  sanitizeAuthoringSkillReferenceCheck,
  type AuthoringSkillReferenceCheck,
} from "@/ai/authoring/skill-checks";
import { extractAuthoringToolGateError } from "@/ai/authoring/tool-gate-error";

const WRITE_TOOLS = new Set(["upsertQuery", "upsertView", "upsertBinding"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeTaskState(
  state: AuthoringTaskStateSnapshot | null | undefined,
): AuthoringTaskStateSnapshot {
  return (
    state ?? {
      phase: "idle",
      loadedSkillReferences: [],
      loadedSkillReferenceChecks: [],
      updatedAt: nowIso(),
    }
  );
}

function uniqueLimited(values: string[], limit = 20) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function shouldReplaceGoalSummary(input: {
  text: string;
  previous: AuthoringTaskStateSnapshot;
  hasPendingApproval?: boolean;
}): boolean {
  if (input.hasPendingApproval || input.previous.lastFailedTool) {
    return false;
  }
  const trimmed = input.text.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.length >= 8;
}

function inferDataModeFromUserText(
  text: string,
): AuthoringTaskStateSnapshot["dataMode"] | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/(mock|placeholder|sample|dummy|占位|示例|样例|模拟|先搭|先建|先画)/i.test(normalized)) {
    return "mock";
  }
  if (/(真实|实际|数据源|字段|表|query|sql|datasource|table|live)/i.test(normalized)) {
    return "live";
  }
  return null;
}

export function updateTaskStateFromUserTurn(input: {
  previous?: AuthoringTaskStateSnapshot | null;
  latestUserText: string;
  hasWorkingDraft?: boolean;
  hasPendingApproval?: boolean;
}): AuthoringTaskStateSnapshot {
  const previous = normalizeTaskState(input.previous);
  const userDataMode = inferDataModeFromUserText(input.latestUserText);
  const phase = input.hasPendingApproval
    ? "awaiting_approval"
    : previous.lastFailedTool
      ? "recovering_tool_error"
      : input.hasWorkingDraft
      ? "drafting"
      : previous.phase;
  const goalSummary = shouldReplaceGoalSummary({
    text: input.latestUserText,
    previous,
    hasPendingApproval: input.hasPendingApproval,
  })
    ? input.latestUserText.trim().slice(0, 500)
    : previous.goalSummary;

  const next: AuthoringTaskStateSnapshot = {
    ...previous,
    phase,
    ...(userDataMode ? { dataMode: userDataMode } : {}),
    ...(goalSummary ? { goalSummary } : {}),
    updatedAt: nowIso(),
  };
  delete next.lastRouteDecision;
  delete next.lastBlockerQuestion;
  return next;
}

function parseToolInput(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function extractSkillReferenceKey(input: unknown): string | null {
  const parsed = parseToolInput(input);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "skill_id" in parsed &&
    "reference_name" in parsed
  ) {
    const skillId = String((parsed as { skill_id?: unknown }).skill_id ?? "").trim();
    const referenceName = String(
      (parsed as { reference_name?: unknown }).reference_name ?? "",
    ).trim();
    return skillId && referenceName ? `${skillId}/${referenceName}` : null;
  }
  return null;
}

function extractSkillReferenceCheck(output: unknown): AuthoringSkillReferenceCheck | null {
  const parsed = parseToolInput(output);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "check" in parsed
  ) {
    return sanitizeAuthoringSkillReferenceCheck(
      (parsed as { check?: unknown }).check,
    );
  }
  return null;
}

function extractBindingMode(input: unknown): AuthoringTaskStateSnapshot["dataMode"] | null {
  const parsed = parseToolInput(input);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "binding" in parsed &&
    typeof (parsed as { binding?: unknown }).binding === "object" &&
    (parsed as { binding?: unknown }).binding !== null
  ) {
    const mode = (parsed as { binding: { mode?: unknown } }).binding.mode ?? "live";
    return mode === "mock" ? "mock" : "live";
  }
  return null;
}

function summarizeFallbackError(value: unknown): string {
  if (value instanceof Error) {
    return value.message.slice(0, 500);
  }
  if (typeof value === "string") {
    return value.slice(0, 500);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "string"
  ) {
    return String((value as { error: string }).error).slice(0, 500);
  }
  return "Tool call did not produce a successful result.";
}

function summarizeToolFailure(
  value: unknown,
): Pick<
  AuthoringToolFailureSnapshot,
  "errorSummary" | "code" | "userSafeSummary" | "recoveryHint" | "retryable"
> {
  const direct = extractAuthoringToolGateError(value);
  if (direct) {
    return {
      errorSummary: direct.userSafeSummary.slice(0, 500),
      code: direct.code,
      userSafeSummary: direct.userSafeSummary.slice(0, 500),
      recoveryHint: direct.recoveryHint.slice(0, 500),
      retryable: direct.retryable,
    };
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value
  ) {
    const nested = summarizeToolFailure((value as { error?: unknown }).error);
    if (nested.code) {
      return nested;
    }
    return {
      errorSummary: nested.errorSummary,
    };
  }

  return {
    errorSummary: summarizeFallbackError(value),
  };
}

function summarizeMissingToolResult(toolName: string) {
  return {
    errorSummary: `${toolName} did not return a tool result. The call may have been aborted, rejected by the provider, or the SDK did not surface an error object.`,
    userSafeSummary: `${toolName} did not return a tool result. Compare your input to the tool schema, then retry; if the failure repeats, check server logs or trace for the underlying cause.`,
    recoveryHint:
      "Validate tool input against the schema, load any required skill references, and retry. If a write tool keeps failing with no result, use read tools to confirm current draft state first.",
    retryable: true,
  };
}

function toolResultHasFailure(result: {
  output?: unknown;
  error?: unknown;
}): boolean {
  return result.error !== undefined;
}

function toolResultSucceeded(result: {
  output?: unknown;
  error?: unknown;
}): boolean {
  return !toolResultHasFailure(result);
}

function nextAttemptCount(input: {
  state: AuthoringTaskStateSnapshot;
  toolName: string;
}): number {
  return input.state.lastFailedTool?.toolName === input.toolName
    ? input.state.lastFailedTool.attemptCount + 1
    : 1;
}

function stagingSuccessResolvesFailure(input: {
  failedToolName: string;
  succeededToolName: string;
}): boolean {
  if (
    input.failedToolName === "runCheck" ||
    input.failedToolName === "composePatch"
  ) {
    return WRITE_TOOLS.has(input.succeededToolName);
  }
  // Bindings complete the write path; clears stale upsertQuery/upsertView failures
  // (e.g. SDK "no tool result" while draft already has the query/view).
  if (
    input.succeededToolName === "upsertBinding" &&
    (input.failedToolName === "upsertQuery" ||
      input.failedToolName === "upsertView")
  ) {
    return true;
  }
  return input.failedToolName === input.succeededToolName;
}

function clearResolvedFailure(input: {
  state: AuthoringTaskStateSnapshot;
  succeededToolName: string;
}): AuthoringTaskStateSnapshot {
  const failedTool = input.state.lastFailedTool;
  if (
    !failedTool ||
    !stagingSuccessResolvesFailure({
      failedToolName: failedTool.toolName,
      succeededToolName: input.succeededToolName,
    })
  ) {
    return input.state;
  }

  const withoutFailure = { ...input.state };
  delete withoutFailure.lastFailedTool;
  return withoutFailure;
}

function isRunCheckErrorOutput(output: unknown): output is {
  status: "error";
  reason?: string;
  failures?: unknown[];
} {
  return (
    typeof output === "object" &&
    output !== null &&
    "status" in output &&
    (output as { status?: unknown }).status === "error"
  );
}

function summarizeRunCheckFailure(output: unknown) {
  if (isRunCheckErrorOutput(output)) {
    return {
      errorSummary:
        typeof output.reason === "string"
          ? output.reason.slice(0, 500)
          : "Runtime check failed.",
      userSafeSummary:
        typeof output.reason === "string"
          ? output.reason.slice(0, 500)
          : "Runtime check failed.",
      recoveryHint:
        "Fix the failed query/view/binding runtime check before composing a patch. Inspect the runCheck failures and update the staged draft.",
      retryable: true,
    };
  }

  return summarizeToolFailure(output);
}

export function updateTaskStateFromToolStep(input: {
  previous?: AuthoringTaskStateSnapshot | null;
  toolCalls?: Array<{ toolName?: string; input?: unknown }>;
  toolResults?: Array<{ toolName?: string; output?: unknown; error?: unknown }>;
}): AuthoringTaskStateSnapshot {
  const previous = normalizeTaskState(input.previous);
  let next: AuthoringTaskStateSnapshot = {
    ...previous,
    updatedAt: nowIso(),
  };

  for (const call of input.toolCalls ?? []) {
    const toolName = call.toolName ?? "";
    if (toolName === "loadSkillReference") {
      const key = extractSkillReferenceKey(call.input);
      if (key) {
        next = {
          ...next,
          loadedSkillReferences: uniqueLimited([
            ...next.loadedSkillReferences,
            key,
          ]),
        };
        const matchingResult = input.toolResults?.find((result) => {
          if (result.toolName !== "loadSkillReference") {
            return false;
          }
          const check = extractSkillReferenceCheck(result.output);
          return check?.reference_key === key;
        });
        const check = extractSkillReferenceCheck(matchingResult?.output);
        if (check) {
          next = {
            ...next,
            loadedSkillReferenceChecks: [
              ...(next.loadedSkillReferenceChecks ?? []).filter(
                (existing) => existing.reference_key !== check.reference_key,
              ),
              check,
            ].slice(0, 20),
          };
        }
      }
    }
    if (toolName === "runCheck") {
      const matchingResults =
        input.toolResults?.filter((result) => result.toolName === toolName) ?? [];
      const failedResult = matchingResults.find(
        (result) => result.error !== undefined || isRunCheckErrorOutput(result.output),
      );
      if (failedResult) {
        next = {
          ...next,
          phase: "recovering_tool_error",
          lastFailedTool: {
            toolName: "runCheck",
            ...(failedResult.error !== undefined
              ? summarizeToolFailure(failedResult.error)
              : summarizeRunCheckFailure(failedResult.output)),
            attemptCount: nextAttemptCount({ state: next, toolName }),
            lastOccurredAt: nowIso(),
          },
        };
      } else if (matchingResults.some(toolResultSucceeded)) {
        const withoutFailure = clearResolvedFailure({
          state: next,
          succeededToolName: toolName,
        });
        next = {
          ...withoutFailure,
          phase: withoutFailure.lastFailedTool
            ? "recovering_tool_error"
            : "drafting",
        };
      }
    }
    if (WRITE_TOOLS.has(toolName)) {
      const matchingResults =
        input.toolResults?.filter((result) => result.toolName === toolName) ?? [];
      const succeeded = matchingResults.some(toolResultSucceeded);
      if (succeeded) {
        const withoutFailure = clearResolvedFailure({
          state: next,
          succeededToolName: toolName,
        });
        const bindingMode =
          toolName === "upsertBinding" ? extractBindingMode(call.input) : null;
        next = {
          ...withoutFailure,
          ...(toolName === "upsertQuery"
            ? { dataMode: "live" as const }
            : bindingMode
              ? { dataMode: bindingMode }
              : {}),
          phase: withoutFailure.lastFailedTool
            ? "recovering_tool_error"
            : "drafting",
        };
      } else {
        const failedResult = matchingResults.find(toolResultHasFailure);
        next = {
          ...next,
          phase: "recovering_tool_error",
          lastFailedTool: {
            toolName: toolName as "upsertQuery" | "upsertView" | "upsertBinding",
            ...(failedResult
              ? summarizeToolFailure(failedResult.error ?? failedResult.output)
              : summarizeMissingToolResult(toolName)),
            attemptCount: nextAttemptCount({ state: next, toolName }),
            lastOccurredAt: nowIso(),
          },
        };
      }
    }
    if (toolName === "composePatch" || toolName === "applyPatch") {
      const matchingResults =
        input.toolResults?.filter((result) => result.toolName === toolName) ?? [];
      const succeeded = matchingResults.some(toolResultSucceeded);
      if (succeeded) {
        const withoutFailure = { ...next };
        delete withoutFailure.lastFailedTool;
        next = {
          ...withoutFailure,
          phase: "awaiting_approval",
        };
      } else {
        const failedResult = matchingResults.find(toolResultHasFailure);
        next = {
          ...next,
          phase: "recovering_tool_error",
          lastFailedTool: {
            toolName: toolName as "composePatch" | "applyPatch",
            ...(failedResult
              ? summarizeToolFailure(failedResult.error ?? failedResult.output)
              : summarizeMissingToolResult(toolName)),
            attemptCount: nextAttemptCount({ state: next, toolName }),
            lastOccurredAt: nowIso(),
          },
        };
      }
    }
  }

  return next;
}
