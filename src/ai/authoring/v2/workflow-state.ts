import type {
  AuthoringGoalV2,
  WorkflowStateV2,
} from "@/ai/authoring/v2/types";

export function nowIso() {
  return new Date().toISOString();
}

function emptyWorkflowState(): WorkflowStateV2 {
  return { goals: [], activeGoalId: null };
}

export function normalizeWorkflowStateV2(
  state?: WorkflowStateV2 | null,
): WorkflowStateV2 {
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

export function isTerminalGoalStatus(status: AuthoringGoalV2["status"]) {
  return status === "blocked" || status === "failed" || status === "completed";
}

export function getActiveGoalV2(state: WorkflowStateV2): AuthoringGoalV2 | null {
  const normalized = normalizeWorkflowStateV2(state);
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

function activeGoalIdForState(state: WorkflowStateV2): string | null {
  return getActiveGoalV2(state)?.id ?? state.activeGoalId ?? null;
}

export function withGoals(
  state: WorkflowStateV2,
  goals: AuthoringGoalV2[],
  activeGoalId = activeGoalIdForState({ ...state, goals }),
): WorkflowStateV2 {
  return {
    ...state,
    goals,
    activeGoalId,
  };
}

export function updateGoal(
  state: WorkflowStateV2,
  goalId: string,
  updater: (goal: AuthoringGoalV2) => AuthoringGoalV2,
): WorkflowStateV2 {
  return withGoals(
    state,
    state.goals.map((goal) => (goal.id === goalId ? updater(goal) : goal)),
  );
}

export function updateActiveGoal(
  state: WorkflowStateV2,
  updater: (goal: AuthoringGoalV2) => AuthoringGoalV2,
): WorkflowStateV2 {
  const goal = getActiveGoalV2(state);
  return goal ? updateGoal(state, goal.id, updater) : state;
}

export function upsertBlocker(
  blockers: AuthoringGoalV2["blockers"],
  kind: string,
  message: string,
) {
  return [
    ...blockers.filter((blocker) => blocker.kind !== kind),
    { kind, message },
  ];
}

export function clearBlockers(
  blockers: AuthoringGoalV2["blockers"],
  kinds: string[],
) {
  const blocked = new Set(kinds);
  return blockers.filter((blocker) => !blocked.has(blocker.kind));
}

export function nextSiblingGoal(
  state: WorkflowStateV2,
  goal: AuthoringGoalV2,
): AuthoringGoalV2 | null {
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

export function allChildGoalsCompleted(state: WorkflowStateV2, parent: AuthoringGoalV2): boolean {
  if (!parent.childGoalIds?.length) {
    return false;
  }
  return parent.childGoalIds.every((childId) => {
    const child = state.goals.find((candidate) => candidate.id === childId);
    return child?.status === "completed";
  });
}

export function parentGoal(state: WorkflowStateV2, goal: AuthoringGoalV2): AuthoringGoalV2 | null {
  return goal.parentGoalId
    ? state.goals.find((candidate) => candidate.id === goal.parentGoalId) ?? null
    : null;
}
