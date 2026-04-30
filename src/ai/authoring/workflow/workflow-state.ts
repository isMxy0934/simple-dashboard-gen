import type {
  AuthoringGoal,
  AuthoringWorkflowState,
} from "@/ai/authoring/workflow/types";

export function nowIso() {
  return new Date().toISOString();
}

function emptyWorkflowState(): AuthoringWorkflowState {
  return { goals: [], activeGoalId: null };
}

export function normalizeAuthoringWorkflowState(
  state?: AuthoringWorkflowState | null,
): AuthoringWorkflowState {
  if (!state) {
    return emptyWorkflowState();
  }
  const goals = Array.isArray(state.goals) ? state.goals : [];
  const activeGoalId =
    state.activeGoalId ??
    goals.find((goal) => !isTerminalGoalStatus(goal.status))?.id ??
    null;
  return {
    goals,
    activeGoalId,
    ...(state.pendingProposalId ? { pendingProposalId: state.pendingProposalId } : {}),
    ...(typeof state.pendingProposalBaseVersion === "number"
      ? { pendingProposalBaseVersion: state.pendingProposalBaseVersion }
      : {}),
    ...(typeof state.pendingProposalDraftFingerprint === "string"
      ? { pendingProposalDraftFingerprint: state.pendingProposalDraftFingerprint }
      : {}),
  };
}

export function isTerminalGoalStatus(status: AuthoringGoal["status"]) {
  return status === "blocked" || status === "failed" || status === "completed";
}

export function getActiveGoal(state: AuthoringWorkflowState): AuthoringGoal | null {
  const normalized = normalizeAuthoringWorkflowState(state);
  const explicit = normalized.activeGoalId
    ? normalized.goals.find((goal) => goal.id === normalized.activeGoalId)
    : null;
  if (explicit && explicit.kind !== "create_dashboard") {
    return explicit;
  }
  if (explicit?.kind === "create_dashboard") {
    const child = normalized.goals.find(
      (goal) =>
        goal.parentGoalId === explicit.id &&
        !isTerminalGoalStatus(goal.status),
    );
    if (child) {
      return child;
    }
  }
  return normalized.goals.find((goal) => !isTerminalGoalStatus(goal.status)) ?? null;
}

function activeGoalIdForState(state: AuthoringWorkflowState): string | null {
  return getActiveGoal(state)?.id ?? state.activeGoalId ?? null;
}

export function withGoals(
  state: AuthoringWorkflowState,
  goals: AuthoringGoal[],
  activeGoalId = activeGoalIdForState({ ...state, goals }),
): AuthoringWorkflowState {
  return {
    ...state,
    goals,
    activeGoalId,
  };
}

export function updateGoal(
  state: AuthoringWorkflowState,
  goalId: string,
  updater: (goal: AuthoringGoal) => AuthoringGoal,
): AuthoringWorkflowState {
  return withGoals(
    state,
    state.goals.map((goal) => (goal.id === goalId ? updater(goal) : goal)),
  );
}

export function updateActiveGoal(
  state: AuthoringWorkflowState,
  updater: (goal: AuthoringGoal) => AuthoringGoal,
): AuthoringWorkflowState {
  const goal = getActiveGoal(state);
  return goal ? updateGoal(state, goal.id, updater) : state;
}

export function upsertBlocker(
  blockers: AuthoringGoal["blockers"],
  kind: string,
  message: string,
) {
  return [
    ...blockers.filter((blocker) => blocker.kind !== kind),
    { kind, message },
  ];
}

export function clearBlockers(
  blockers: AuthoringGoal["blockers"],
  kinds: string[],
) {
  const blocked = new Set(kinds);
  return blockers.filter((blocker) => !blocked.has(blocker.kind));
}

export function nextSiblingGoal(
  state: AuthoringWorkflowState,
  goal: AuthoringGoal,
): AuthoringGoal | null {
  if (!goal.parentGoalId) {
    return null;
  }
  const parent = parentGoal(state, goal);
  if (parent?.childGoalIds?.length) {
    const currentIndex = parent.childGoalIds.indexOf(goal.id);
    const nextId = currentIndex >= 0 ? parent.childGoalIds[currentIndex + 1] : undefined;
    if (!nextId) {
      return null;
    }
    const next = state.goals.find((candidate) => candidate.id === nextId);
    return next && !isTerminalGoalStatus(next.status) ? next : null;
  }
  return (
    state.goals.find(
      (candidate) =>
        candidate.parentGoalId === goal.parentGoalId &&
        candidate.id !== goal.id &&
        !isTerminalGoalStatus(candidate.status),
    ) ?? null
  );
}

export function allChildGoalsCompleted(state: AuthoringWorkflowState, parent: AuthoringGoal): boolean {
  if (!parent.childGoalIds?.length) {
    return false;
  }
  return parent.childGoalIds.every((childId) => {
    const child = state.goals.find((candidate) => candidate.id === childId);
    return child?.status === "completed";
  });
}

export function parentGoal(state: AuthoringWorkflowState, goal: AuthoringGoal): AuthoringGoal | null {
  return goal.parentGoalId
    ? state.goals.find((candidate) => candidate.id === goal.parentGoalId) ?? null
    : null;
}
