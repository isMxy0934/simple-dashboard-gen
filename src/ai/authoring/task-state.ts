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

function normalizeUserReply(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s,.!?，。！？、；;:：]/g, "");
}

function shouldReplaceGoalSummary(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = normalizeUserReply(trimmed);
  const shortOperationalReplies = new Set([
    "好",
    "好的",
    "可以",
    "可以的",
    "行",
    "对",
    "是",
    "是的",
    "嗯",
    "确认",
    "继续",
    "创建",
    "创建呀",
    "生成",
    "开始",
    "ok",
    "okay",
    "yes",
    "goahead",
  ]);
  return !shortOperationalReplies.has(normalized) && trimmed.length >= 8;
}

export function updateTaskStateFromUserTurn(input: {
  previous?: AuthoringTaskStateSnapshot | null;
  latestUserText: string;
  hasWorkingDraft?: boolean;
  hasPendingApproval?: boolean;
}): AuthoringTaskStateSnapshot {
  const previous = normalizeTaskState(input.previous);
  const phase = input.hasPendingApproval
    ? "awaiting_approval"
    : input.hasWorkingDraft
      ? "drafting"
      : previous.phase;
  const goalSummary = shouldReplaceGoalSummary(input.latestUserText)
    ? input.latestUserText.trim().slice(0, 500)
    : previous.goalSummary;

  const next: AuthoringTaskStateSnapshot = {
    ...previous,
    phase,
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
    if (WRITE_TOOLS.has(toolName)) {
      const matchingResults =
        input.toolResults?.filter((result) => result.toolName === toolName) ?? [];
      const succeeded = matchingResults.some(
        (result) => result.error === undefined,
      );
      if (succeeded) {
        const withoutFailure = { ...next };
        delete withoutFailure.lastFailedTool;
        next = {
          ...withoutFailure,
          phase: "drafting",
        };
      } else {
        next = {
          ...next,
          phase: "recovering_tool_error",
          lastFailedTool: {
            toolName: toolName as "upsertQuery" | "upsertView" | "upsertBinding",
            ...summarizeToolFailure(
              matchingResults.find((result) => result.error !== undefined)?.error,
            ),
            attemptCount:
              previous.lastFailedTool?.toolName === toolName
                ? previous.lastFailedTool.attemptCount + 1
                : 1,
            lastOccurredAt: nowIso(),
          },
        };
      }
    }
    if (toolName === "composePatch" || toolName === "applyPatch") {
      const matchingResults =
        input.toolResults?.filter((result) => result.toolName === toolName) ?? [];
      const succeeded = matchingResults.some(
        (result) => result.error === undefined,
      );
      if (succeeded) {
        const withoutFailure = { ...next };
        delete withoutFailure.lastFailedTool;
        next = {
          ...withoutFailure,
          phase: "awaiting_approval",
        };
      } else {
        next = {
          ...next,
          phase: "recovering_tool_error",
          lastFailedTool: {
            toolName: toolName as "composePatch" | "applyPatch",
            ...summarizeToolFailure(
              matchingResults.find((result) => result.error !== undefined)?.error,
            ),
            attemptCount:
              previous.lastFailedTool?.toolName === toolName
                ? previous.lastFailedTool.attemptCount + 1
                : 1,
            lastOccurredAt: nowIso(),
          },
        };
      }
    }
  }

  return next;
}
