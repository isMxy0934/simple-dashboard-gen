import type {
  AuthoringRouteAdvice,
  AuthoringTaskStateSnapshot,
} from "@/ai/authoring/contracts/session-state";

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
      updatedAt: nowIso(),
    }
  );
}

function uniqueLimited(values: string[], limit = 20) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

export function updateTaskStateFromRouteAdvice(input: {
  previous?: AuthoringTaskStateSnapshot | null;
  latestUserText: string;
  advice: AuthoringRouteAdvice;
}): AuthoringTaskStateSnapshot {
  const previous = normalizeTaskState(input.previous);
  const phase =
    input.advice.route === "approval"
      ? "awaiting_approval"
      : input.advice.route === "author-dashboard" ||
          input.advice.route === "author-focused"
        ? input.advice.dataContextStatus === "confirmed"
          ? "ready_to_draft"
          : previous.phase
        : input.advice.dataContextStatus === "candidate-recommended"
          ? "awaiting_data_confirmation"
          : input.advice.dataContextStatus === "missing"
            ? "discovering_data"
            : previous.phase === "idle"
              ? "ready_to_draft"
              : previous.phase;

  return {
    ...previous,
    phase,
    goalSummary: input.latestUserText.trim().slice(0, 500) || previous.goalSummary,
    lastRouteDecision: input.advice,
    loadedSkillReferences: uniqueLimited([
      ...previous.loadedSkillReferences,
      ...input.advice.recommendedSkillIds.map((id) => `${id}:recommended`),
    ]),
    ...(input.advice.shouldAskBlocker
      ? { lastBlockerQuestion: input.advice.reason.slice(0, 500) }
      : {}),
    ...(input.advice.dataContextStatus === "confirmed" &&
    previous.selectedDataContext
      ? { selectedDataContext: previous.selectedDataContext }
      : {}),
    updatedAt: nowIso(),
  };
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

function summarizeError(value: unknown): string {
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

export function updateTaskStateFromToolStep(input: {
  previous?: AuthoringTaskStateSnapshot | null;
  toolCalls?: Array<{ toolName?: string; input?: unknown }>;
  toolResults?: Array<{ toolName?: string; output?: unknown; error?: unknown }>;
}): AuthoringTaskStateSnapshot {
  const previous = normalizeTaskState(input.previous);
  const resultNames = new Set(
    (input.toolResults ?? [])
      .map((result) => result.toolName)
      .filter((name): name is string => typeof name === "string"),
  );
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
      }
    }
    if (WRITE_TOOLS.has(toolName)) {
      const succeeded = resultNames.has(toolName);
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
            errorSummary: summarizeError(
              input.toolResults?.find((result) => result.toolName === toolName)
                ?.error,
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
      next = {
        ...next,
        phase: "awaiting_approval",
      };
    }
  }

  return next;
}
