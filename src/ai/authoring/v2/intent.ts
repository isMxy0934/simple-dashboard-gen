import type {
  AuthoringDataModeV2,
  AuthoringGoalV2,
  TurnIntentV2,
  ViewGoalV2,
} from "@/ai/authoring/v2/types";

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

function inferChartTypeFromText(text: string): ViewGoalV2["chartType"] | undefined {
  if (/(折线|趋势|时间序列|time\s*series|timeseries|trend|line)/i.test(text)) {
    return "line";
  }
  if (/(柱状|条形|排行|排名|top\s*n|bar|ranking|rank)/i.test(text)) {
    return "bar";
  }
  if (/(指标|卡片|kpi|metric\s*card|scorecard)/i.test(text)) {
    return "kpi";
  }
  if (/(面积|area)/i.test(text)) {
    return "area";
  }
  if (/(饼图|pie)/i.test(text)) {
    return "pie";
  }
  if (/(表格|明细|列表|table|detail)/i.test(text)) {
    return "table";
  }
  return undefined;
}

function inferDataModeFromText(
  text: string,
): Exclude<AuthoringDataModeV2, "undecided"> | undefined {
  if (/(mock|占位|示例|样例|模拟|placeholder|sample)/i.test(text)) {
    return "mock";
  }
  if (/(真实|实际|数据源|字段|数据表|query|sql|datasource|table|live)/i.test(text)) {
    return "live";
  }
  return undefined;
}

export function resolveDataModeV2(input: {
  intent: TurnIntentV2;
  selectedDatasourceId?: string | null;
  selectedTable?: string | null;
}): AuthoringDataModeV2 {
  if (input.intent.kind !== "create_view") {
    return "undecided";
  }
  if (input.intent.goal.dataMode) {
    return input.intent.goal.dataMode;
  }
  if (input.intent.goal.datasourceId || input.intent.goal.table) {
    return "live";
  }
  if (input.selectedDatasourceId || input.selectedTable) {
    return "live";
  }
  return "undecided";
}

export function resolveIntentV2(input: {
  latestUserText?: string | null;
  approvalEvent?: Extract<TurnIntentV2, { kind: "approve_patch_event" }> | null;
}): TurnIntentV2 {
  if (input.approvalEvent) {
    return input.approvalEvent;
  }
  const text = input.latestUserText?.trim() ?? "";
  const normalized = text.toLowerCase();
  if (!text) {
    return { kind: "chat" };
  }
  if (/(schema|表结构|字段|有哪些表|有哪些数据|数据源|datasource|tables?)/i.test(normalized)) {
    return { kind: "explore_data", scope: "datasources" };
  }
  const chartType = inferChartTypeFromText(text);
  const dataMode = inferDataModeFromText(normalized);
  const hasCreateVerb = /(创建|新增|添加|生成|做|搭建|画|展示|可视化|create|add|build|generate|show)/i.test(
    normalized,
  );
  const hasOutputNoun = /(图|图表|报表|卡片|视图|看板|chart|view|dashboard|report)/i.test(
    normalized,
  );
  if (hasCreateVerb && (hasOutputNoun || chartType)) {
    return {
      kind: "create_view",
      goal: {
        summary: text,
        ...(chartType ? { chartType } : {}),
        ...(dataMode ? { dataMode } : {}),
      },
    };
  }
  if (dataMode) {
    return { kind: "set_data_mode", dataMode };
  }
  if (/(确认|可以|同意|approve|approved|ok|okay|go ahead)/i.test(normalized)) {
    return { kind: "approve_patch_text", decision: "approve" };
  }
  if (/(拒绝|取消|reject|cancel)/i.test(normalized)) {
    return { kind: "approve_patch_text", decision: "reject" };
  }
  return { kind: "chat" };
}

export function createGoalFromIntentV2(input: {
  intent: TurnIntentV2;
  turnId: string;
  now?: string;
  selectedDatasourceId?: string | null;
  selectedTable?: string | null;
}): AuthoringGoalV2 | null {
  if (input.intent.kind !== "create_view") {
    return null;
  }
  const now = input.now ?? nowIso();
  const goal = input.intent.goal;
  const summary = goal.summary?.trim() || "Create dashboard view";
  const dataMode = resolveDataModeV2({
    intent: input.intent,
    selectedDatasourceId: input.selectedDatasourceId,
    selectedTable: input.selectedTable,
  });
  return {
    id: `goal_${slugPart(input.turnId || summary) || Date.now()}`,
    kind: "create_view",
    status: "active",
    summary,
    dataMode,
    chartPlan: {
      ...(goal.chartType ? { chartType: goal.chartType } : {}),
      ...(goal.metrics ? { metrics: [...goal.metrics] } : {}),
      ...(goal.dimensions ? { dimensions: [...goal.dimensions] } : {}),
      ...(goal.timeGrain ? { timeGrain: goal.timeGrain } : {}),
    },
    targetRefs: {
      ...(goal.datasourceId || input.selectedDatasourceId
        ? { datasourceId: goal.datasourceId ?? input.selectedDatasourceId ?? undefined }
        : {}),
      ...(goal.table || input.selectedTable
        ? { table: goal.table ?? input.selectedTable ?? undefined }
        : {}),
    },
    blockers: [],
    createdFromTurnId: input.turnId,
    createdAt: now,
    updatedAt: now,
  };
}
