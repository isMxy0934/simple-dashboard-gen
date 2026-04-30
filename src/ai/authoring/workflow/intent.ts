import type {
  AuthoringDataMode,
  AuthoringGoal,
  DashboardGoal,
  TurnIntent,
  ViewGoal,
} from "@/ai/authoring/workflow/types";

function nowIso() {
  return new Date().toISOString();
}

function slugPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function resolveDataMode(input: {
  intent: TurnIntent;
  selectedDatasourceId?: string | null;
  selectedTable?: string | null;
}): AuthoringDataMode {
  if (
    input.intent.kind !== "create_view" &&
    input.intent.kind !== "revise_view" &&
    input.intent.kind !== "create_dashboard"
  ) {
    return "undecided";
  }
  const dataMode = input.intent.goal.dataMode;
  if (dataMode === "mock" || dataMode === "live") {
    return dataMode;
  }
  if (
    input.intent.goal.datasourceId ||
    input.intent.goal.table ||
    input.selectedDatasourceId ||
    input.selectedTable
  ) {
    return "live";
  }
  return "undecided";
}

function chartPlanFromGoal(goal: ViewGoal): AuthoringGoal["chartPlan"] {
  return {
    ...(goal.chartSkillId ? { chartSkillId: goal.chartSkillId } : {}),
    ...(goal.requestedChartLabel
      ? { requestedChartLabel: goal.requestedChartLabel }
      : {}),
    ...(goal.metrics ? { metrics: [...goal.metrics] } : {}),
    ...(goal.dimensions ? { dimensions: [...goal.dimensions] } : {}),
    ...(goal.timeGrain ? { timeGrain: goal.timeGrain } : {}),
  };
}

function targetRefsFromGoal(input: {
  goal: ViewGoal | DashboardGoal;
  selectedDatasourceId?: string | null;
  selectedTable?: string | null;
}): AuthoringGoal["targetRefs"] {
  return {
    ...(input.goal.datasourceId || input.selectedDatasourceId
      ? { datasourceId: input.goal.datasourceId ?? input.selectedDatasourceId ?? undefined }
      : {}),
    ...(input.goal.table || input.selectedTable
      ? { table: input.goal.table ?? input.selectedTable ?? undefined }
      : {}),
    ...("targetViewId" in input.goal && input.goal.targetViewId
      ? { viewId: input.goal.targetViewId }
      : {}),
  };
}

export function createGoalFromIntent(input: {
  intent: Extract<TurnIntent, { kind: "create_view" | "revise_view" }>;
  turnId: string;
  now?: string;
  selectedDatasourceId?: string | null;
  selectedTable?: string | null;
  parentGoalId?: string;
  sequence?: number;
}): AuthoringGoal | null {
  const now = input.now ?? nowIso();
  const goal = input.intent.goal;
  const summary = goal.summary?.trim() || "Create dashboard view";
  const dataMode = resolveDataMode({
    intent: input.intent,
    selectedDatasourceId: input.selectedDatasourceId,
    selectedTable: input.selectedTable,
  });
  return {
    id: `goal_${slugPart(
      `${input.turnId}_${input.intent.kind}_${input.sequence ?? 0}_${summary}`,
    ) || Date.now()}`,
    kind: input.intent.kind,
    status: "active",
    ...(input.parentGoalId ? { parentGoalId: input.parentGoalId } : {}),
    summary,
    dataMode,
    chartPlan: chartPlanFromGoal(goal),
    targetRefs: targetRefsFromGoal({
      goal,
      selectedDatasourceId: input.selectedDatasourceId,
      selectedTable: input.selectedTable,
    }),
    blockers: [],
    createdFromTurnId: input.turnId,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDashboardGoalsFromIntent(input: {
  intent: Extract<TurnIntent, { kind: "create_dashboard" }>;
  turnId: string;
  now?: string;
  selectedDatasourceId?: string | null;
  selectedTable?: string | null;
}): AuthoringGoal[] {
  const now = input.now ?? nowIso();
  const parentSummary =
    input.intent.goal.summary?.trim() || "Create dashboard";
  const parentId = `goal_${slugPart(`${input.turnId}_dashboard_${parentSummary}`) || Date.now()}`;
  const parentDataMode = resolveDataMode({
    intent: input.intent,
    selectedDatasourceId: input.selectedDatasourceId,
    selectedTable: input.selectedTable,
  });
  const children = input.intent.goal.views.map((viewGoal, index) =>
    createGoalFromIntent({
      intent: {
        kind: "create_view",
        goal: {
          ...viewGoal,
          dataMode: viewGoal.dataMode ?? parentDataMode,
          chartSkillId: viewGoal.chartSkillId ?? input.intent.goal.chartSkillId,
          requestedChartLabel:
            viewGoal.requestedChartLabel ?? input.intent.goal.requestedChartLabel,
          datasourceId: viewGoal.datasourceId ?? input.intent.goal.datasourceId,
          table: viewGoal.table ?? input.intent.goal.table,
        },
      },
      turnId: input.turnId,
      now,
      selectedDatasourceId: input.selectedDatasourceId,
      selectedTable: input.selectedTable,
      parentGoalId: parentId,
      sequence: index,
    }),
  ).filter((goal): goal is AuthoringGoal => goal !== null);

  return [
    {
      id: parentId,
      kind: "create_dashboard",
      status: "active",
      childGoalIds: children.map((child) => child.id),
      summary: parentSummary,
      dataMode: parentDataMode,
      targetRefs: targetRefsFromGoal({
        goal: input.intent.goal,
        selectedDatasourceId: input.selectedDatasourceId,
        selectedTable: input.selectedTable,
      }),
      blockers: [],
      createdFromTurnId: input.turnId,
      createdAt: now,
      updatedAt: now,
    },
    ...children,
  ];
}
