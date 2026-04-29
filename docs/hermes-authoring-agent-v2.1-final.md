# Hermes Authoring Agent v2.1 最终设计基线

本文沉淀 Hermes Authoring Agent v2.1 的最终设计原则，用于替代原 v2 草案中容易复现旧 `phase` 问题的部分。

核心决策：

```text
Goal 不记录临时步骤
下一步永远由 decideNextAction 纯函数推导
```

这两个原则优先级最高。任何实现如果把 `staging_query`、`staging_view`、`checking` 这类 transient runtime step 持久化到 `AuthoringGoal.status`，都应视为偏离 v2.1。

---

# 1. 最终职责边界

```text
TurnIntent        本轮用户意图
AuthoringGoal     跨 turn 的用户目标事实
DataMode          目标级数据模式决策
ContextStatus     当前目标需要的上下文是否已加载
ArtifactStatus    当前目标相关 artifact 的事实状态
WorkflowAction    当前唯一下一步动作
ForcedToolStep    Runtime 强制执行的工具步骤
WorkingDraft      待提交 artifact
PatchProposal     待用户审批的变更提案
DashboardDocument 已应用的 dashboard 事实源
```

Agent 负责生成内容：

```text
SQL
ViewSpec
BindingSpec
LayoutSpec
错误解释
用户反馈文本
```

Workflow Runtime 负责推进流程：

```text
是否需要读 schema
是否需要加载 skill reference
是否 stage query/view/binding/layout
是否 runCheck
是否 composePatch
是否 await approval
是否 applyPatch
```

Prompt 只负责内容质量，不负责流程完整性。

## 1.1 TurnIntent 语义

`TurnIntent` 是本轮用户输入或 UI 事件解析后的结构化意图。

MVP 类型：

```ts
type TurnIntent =
  | { kind: "chat" }
  | {
      kind: "explore_data";
      scope: "datasources" | "schema";
      datasourceId?: string;
      table?: string;
    }
  | { kind: "advise_analysis" }
  | { kind: "create_view"; goal: ViewGoal }
  | {
      kind: "approve_patch_text";
      decision: "approve" | "reject" | "revise";
    }
  | {
      kind: "approve_patch_event";
      proposalId: string;
      decision: "approve" | "reject";
      baseVersion: number;
    };
```

规则：

```text
approve_patch_text 来自普通聊天文本，例如“确认”“可以”
approve_patch_event 来自 UI approval event 或等价的明确审批事件
只有 approve_patch_event 可以触发 applyPatch
普通文本确认最多进入 await_approval / renderApproval，不直接 apply
```

---

# 2. AuthoringGoal：只保存目标事实

`AuthoringGoal` 不保存当前 transient step。

推荐结构：

```ts
type AuthoringGoalStatus =
  | "active"
  | "awaiting_user"
  | "awaiting_approval"
  | "blocked"
  | "completed"
  | "failed";

type AuthoringGoal = {
  id: string;

  kind:
    | "create_view"
    | "revise_view"
    | "create_dashboard"
    | "repair_draft";

  status: AuthoringGoalStatus;

  summary: string;

  dataMode: "live" | "mock" | "undecided";

  chartPlan?: {
    chartType?: "line" | "bar" | "table" | "kpi" | "area" | "pie";
    metrics?: string[];
    dimensions?: string[];
    timeGrain?: "day" | "week" | "month";
  };

  targetRefs: {
    datasourceId?: string;
    table?: string;
    queryId?: string;
    viewId?: string;
    bindingIds?: string[];
    layoutId?: string;
  };

  blockers: Array<{
    kind:
      | "missing_datasource"
      | "missing_schema"
      | "missing_metric"
      | "missing_dimension"
      | "ambiguous_data_mode"
      | "check_failed"
      | "needs_user_confirmation";
    message: string;
  }>;

  createdFromTurnId: string;
  createdAt: string;
  updatedAt: string;
};
```

明确不允许：

```ts
status: "staging_query"
status: "staging_view"
status: "staging_binding"
status: "staging_layout"
status: "checking"
status: "composing_patch"
```

这些都属于 `WorkflowAction`，不属于 `AuthoringGoal`。

---

# 3. WorkflowState：保存 workflow 事实，不保存下一步

```ts
type WorkflowState = {
  activeGoal: AuthoringGoal | null;
  pendingProposalId?: string;
};
```

不变量：

```text
activeGoal = null 表示当前没有创作任务
activeGoal != null 时，Workflow 必须推进、等待用户、或 blocked
activeGoal.status = completed 后，不再 stage artifact
activeGoal.status = awaiting_approval 时，只能处理 approve / reject / revise
```

WorkflowState 不保存 `nextAction`。下一步每次都由 `decideNextAction()` 现算。

---

# 4. ContextStatus：显式表示 read context 是否完成

v2.1 明确把 schema / skill reference 读取纳入 workflow。

```ts
type ContextStatus = {
  datasourcesLoaded: boolean;

  schemaLoadedFor?: {
    datasourceId: string;
    table?: string;
    fingerprint?: string;
    loadedAt: string;
  };

  chartSkillLoadedFor?: {
    chartType: string;
    referenceKey: string;
    version?: string;
    loadedAt: string;
  };

  dataFormatSkillLoadedFor?: {
    shape: "time_series" | "category_series" | "detail_rows" | "scalar_kpi";
    referenceKey: string;
    version?: string;
    loadedAt: string;
  };
};
```

原则：

```text
live query 前必须有 schema context
view generation 前必须有 chart skill context
binding generation 前应有 data-format context
ContextStatus 只描述已加载上下文事实，不决定下一步动作
ContextStatus 必须和当前 activeGoal 匹配，不能只判断“曾经加载过”
ContextStatus 必须考虑 identity / version / freshness
```

匹配规则：

```ts
function hasGoalSchemaContext(
  goal: AuthoringGoal,
  contextStatus: ContextStatus,
  currentSchemaFingerprint?: string,
): boolean {
  if (goal.dataMode !== "live") {
    return true;
  }

  const loaded = contextStatus.schemaLoadedFor;
  if (!loaded || !goal.targetRefs.datasourceId) {
    return false;
  }

  if (loaded.datasourceId !== goal.targetRefs.datasourceId) {
    return false;
  }

  if (goal.targetRefs.table && loaded.table !== goal.targetRefs.table) {
    return false;
  }

  if (
    currentSchemaFingerprint &&
    loaded.fingerprint &&
    loaded.fingerprint !== currentSchemaFingerprint
  ) {
    return false;
  }

  return true;
}

function hasSchemaContextForIntent(
  intent: Extract<TurnIntent, { kind: "explore_data" }>,
  contextStatus: ContextStatus,
): boolean {
  if (intent.scope !== "schema") {
    return contextStatus.datasourcesLoaded;
  }

  const loaded = contextStatus.schemaLoadedFor;
  if (!loaded || !intent.datasourceId) {
    return false;
  }

  if (loaded.datasourceId !== intent.datasourceId) {
    return false;
  }

  if (intent.table && loaded.table !== intent.table) {
    return false;
  }

  return true;
}

function hasGoalChartSkillContext(
  goal: AuthoringGoal,
  contextStatus: ContextStatus,
  currentSkillVersion?: string,
): boolean {
  const chartType = goal.chartPlan?.chartType;
  return Boolean(
    chartType &&
      contextStatus.chartSkillLoadedFor?.chartType === chartType &&
      contextStatus.chartSkillLoadedFor.referenceKey &&
      (!currentSkillVersion ||
        !contextStatus.chartSkillLoadedFor.version ||
        contextStatus.chartSkillLoadedFor.version === currentSkillVersion),
  );
}

function hasGoalDataFormatContext(
  _goal: AuthoringGoal,
  contextStatus: ContextStatus,
  currentSkillVersion?: string,
): boolean {
  const loaded = contextStatus.dataFormatSkillLoadedFor;
  return Boolean(
    loaded?.referenceKey &&
      (!currentSkillVersion ||
        !loaded.version ||
        loaded.version === currentSkillVersion),
  );
}
```

说明：

```text
A 表 schema 已加载，不能用于 B 表 create_view
line chart skill 已加载，不能直接视为 bar/table skill 已加载
data-format skill 用于 binding/input shape，不应和 chart skill 混为一个布尔值
```

失效规则：

```text
datasource schema fingerprint 改变 -> schema context invalid
goal.targetRefs.datasourceId/table 改变 -> schema context invalid
goal.chartPlan.chartType 改变 -> chart skill context invalid
chart skill version 改变 -> chart skill context invalid
data-format skill version 改变 -> data-format context invalid
```

---

# 5. ArtifactStatus：必须 goal-scoped

ArtifactStatus 只检查当前 `activeGoal` 相关 artifact，不能检查 dashboard 全局是否有任意 query/view。

```ts
type ArtifactStatus = {
  expectedDataMode: "live" | "mock" | "undecided";
  observedDataMode?: "live" | "mock" | "mixed" | "none";
  dataModeConsistent: boolean;

  query: {
    required: boolean;
    exists: boolean;
    valid: boolean;
    issues: string[];
  };

  view: {
    required: boolean;
    exists: boolean;
    valid: boolean;
    missingRequiredSlots: string[];
    issues: string[];
  };

  binding: {
    required: boolean;
    exists: boolean;
    valid: boolean;
    missingSlots: string[];
    issues: string[];
  };

  layout: {
    required: boolean;
    existsDesktop: boolean;
    existsMobile: boolean;
    valid: boolean;
    issues: string[];
  };

  runtimeCheck: {
    required: boolean;
    status: "not_run" | "passed" | "failed" | "stale" | "not_applicable";
    errors: RuntimeCheckError[];
  };

  patch: {
    composed: boolean;
    stale: boolean;
    proposalId?: string;
  };
};
```

实现原则：

```text
如果 goal.targetRefs.queryId 存在，只检查该 query
如果 goal.targetRefs.viewId 存在，只检查该 view
如果 targetRefs 尚未写入，检查该 goal 创建的 dirty ids
不能用 candidate.query_defs.length > 0 判断当前 goal query.exists
不能用 candidate.dashboard_spec.views.length > 0 判断当前 goal view.exists
```

为了让 “该 goal 创建的 dirty ids” 可实现，WorkingDraft 必须记录 artifact ownership。

推荐最小结构：

```ts
type WorkingDraftArtifactOwner = {
  goalId: string;
  artifactKind: "query" | "view" | "binding" | "layout";
  artifactId: string;
  createdAt: string;
  updatedAt: string;
};

type WorkingDraftOwnership = {
  byArtifactId: Record<string, WorkingDraftArtifactOwner>;
  byGoalId: Record<string, string[]>;
  currentByGoal: Record<
    string,
    {
      queryId?: string;
      viewId?: string;
      bindingIds?: string[];
      layoutId?: string;
    }
  >;
};
```

每个 draft mutation tool 都必须记录 ownership：

```text
upsertQuery   -> owner(goalId, "query", queryId)
upsertView    -> owner(goalId, "view", viewId)
upsertBinding -> owner(goalId, "binding", bindingId)
upsertLayout  -> owner(goalId, "layout", viewId/layoutId)
```

Inspector 查找顺序：

```text
1. 优先检查 goal.targetRefs 中的 artifact id
2. 如果 targetRefs 尚未写入，检查 WorkingDraftOwnership.currentByGoal[goal.id]
3. 如果 currentByGoal 也缺失，从 WorkingDraftOwnership.byGoalId[goal.id] 按 artifactKind + updatedAt 选最新
4. 禁止退回 dashboard 全局 hasQuery/hasView 判断
```

说明：

```text
同一个 goal 可能多次生成 query/view/binding
currentByGoal 表示该 goal 当前有效 artifact
历史 artifact 可以继续保留用于调试或 patch diff，但 Inspector 默认只看 current artifact
```

---

# 6. WorkflowAction：唯一下一步

```ts
type WorkflowAction =
  | { kind: "answer"; reason: string }
  | { kind: "ask_user"; question: string; blocker: string }
  | { kind: "block_goal"; reason: string; blocker: string }
  | { kind: "prepare_data_context"; tool: "getDatasources" | "getSchemaByDatasource" }
  | { kind: "prepare_query_context"; tool: "getSchemaByDatasource" }
  | {
      kind: "prepare_view_context";
      tool: "loadSkillReference";
      referenceKind: "chart" | "data_format";
    }
  | { kind: "stage_query"; tool: "upsertQuery" }
  | { kind: "stage_view"; tool: "upsertView" }
  | { kind: "stage_binding"; tool: "upsertBinding" }
  | { kind: "stage_layout"; tool: "upsertLayout" }
  | { kind: "run_check"; tool: "runCheck" }
  | { kind: "compose_patch"; tool: "composePatch" }
  | { kind: "await_approval" }
  | { kind: "apply_patch"; tool: "applyPatch" };
```

`WorkflowAction` 是当前 step，不持久化为 goal status。

---

# 7. decideNextAction：纯函数推导下一步

```ts
export function decideNextAction(input: {
  intent: TurnIntent;
  workflowState: WorkflowState;
  contextStatus: ContextStatus;
  artifactStatus: ArtifactStatus;
  approvalState: ApprovalState;
}): WorkflowAction {
  const { intent, workflowState, contextStatus, artifactStatus, approvalState } = input;

  if (intent.kind === "chat") {
    return { kind: "answer", reason: "chat_only" };
  }

  if (intent.kind === "explore_data") {
    if (intent.scope === "datasources" && !contextStatus.datasourcesLoaded) {
      return { kind: "prepare_data_context", tool: "getDatasources" };
    }

    if (
      intent.scope === "schema" &&
      !hasSchemaContextForIntent(intent, contextStatus)
    ) {
      return { kind: "prepare_data_context", tool: "getSchemaByDatasource" };
    }

    return { kind: "answer", reason: "data_context_ready" };
  }

  if (intent.kind === "approve_patch_text") {
    if (workflowState.pendingProposalId) {
      return { kind: "await_approval" };
    }

    return { kind: "answer", reason: "no_pending_proposal_for_text_approval" };
  }

  if (intent.kind === "approve_patch_event") {
    if (
      intent.decision === "approve" &&
      approvalState.pendingProposalId === intent.proposalId &&
      approvalState.baseVersion === intent.baseVersion &&
      approvalState.userApproved === true
    ) {
      return { kind: "apply_patch", tool: "applyPatch" };
    }

    return { kind: "answer", reason: "no_approved_pending_proposal" };
  }

  const goal = workflowState.activeGoal;

  if (!goal) {
    return {
      kind: "ask_user",
      blocker: "missing_active_goal",
      question: "我还没有明确要创建或修改哪个报表对象。",
    };
  }

  if (goal.status === "blocked" || goal.status === "failed") {
    return { kind: "answer", reason: goal.status };
  }

  if (goal.status === "awaiting_approval") {
    return { kind: "await_approval" };
  }

  if (goal.dataMode === "undecided") {
    return {
      kind: "ask_user",
      blocker: "ambiguous_data_mode",
      question: "这个图表要使用真实数据，还是先用 mock 数据占位？",
    };
  }

  if (!artifactStatus.dataModeConsistent) {
    return {
      kind: "block_goal",
      blocker: "data_mode_mismatch",
      reason:
        "The staged artifacts do not match the active goal dataMode. Stop before check/compose and ask the runtime to repair or restart this draft.",
    };
  }

  if (goal.dataMode === "live" && !hasGoalSchemaContext(goal, contextStatus)) {
    return { kind: "prepare_query_context", tool: "getSchemaByDatasource" };
  }

  if (!hasGoalChartSkillContext(goal, contextStatus)) {
    return {
      kind: "prepare_view_context",
      tool: "loadSkillReference",
      referenceKind: "chart",
    };
  }

  if (goal.dataMode === "live" && !artifactStatus.query.exists) {
    return { kind: "stage_query", tool: "upsertQuery" };
  }

  if (!artifactStatus.view.exists) {
    return { kind: "stage_view", tool: "upsertView" };
  }

  if (
    artifactStatus.binding.required &&
    (!artifactStatus.binding.exists || artifactStatus.binding.missingSlots.length > 0) &&
    !hasGoalDataFormatContext(goal, contextStatus)
  ) {
    return {
      kind: "prepare_view_context",
      tool: "loadSkillReference",
      referenceKind: "data_format",
    };
  }

  if (!artifactStatus.binding.exists || artifactStatus.binding.missingSlots.length > 0) {
    return { kind: "stage_binding", tool: "upsertBinding" };
  }

  if (!artifactStatus.layout.existsDesktop || !artifactStatus.layout.existsMobile) {
    return { kind: "stage_layout", tool: "upsertLayout" };
  }

  if (
    artifactStatus.runtimeCheck.required &&
    (artifactStatus.runtimeCheck.status === "not_run" ||
      artifactStatus.runtimeCheck.status === "stale")
  ) {
    return { kind: "run_check", tool: "runCheck" };
  }

  if (
    artifactStatus.runtimeCheck.required &&
    artifactStatus.runtimeCheck.status === "failed"
  ) {
    return {
      kind: "block_goal",
      blocker: "check_failed",
      reason:
        "Runtime check failed. MVP does not auto-repair; stop and surface the error.",
    };
  }

  if (!artifactStatus.patch.composed || artifactStatus.patch.stale) {
    return { kind: "compose_patch", tool: "composePatch" };
  }

  return { kind: "await_approval" };
}
```

要求：

```text
decideNextAction 不读写外部状态
decideNextAction 不调用模型
decideNextAction 不调用工具
同样输入必须稳定返回同样 action
```

---

# 8. ForcedToolStep：按 action 强制工具

```ts
function prepareForcedToolStep(action: WorkflowAction): {
  activeTools: string[];
  toolChoice: "none" | { type: "tool"; toolName: string };
} {
  switch (action.kind) {
    case "answer":
    case "ask_user":
    case "block_goal":
    case "await_approval":
      return { activeTools: [], toolChoice: "none" };

    default:
      return {
        activeTools: [action.tool],
        toolChoice: { type: "tool", toolName: action.tool },
      };
  }
}
```

读取 context 和写 artifact 都是 workflow step，但每一步只开放一个被强制工具。

---

# 9. Workflow Transition：action 执行后的状态更新

`decideNextAction()` 只决定下一步，不修改状态。

工具执行只返回结果，不决定下一步。

状态更新分为两个明确边界：

```text
applyWorkflowTransition 负责更新 WorkflowState / AuthoringGoal / pendingProposalId
write tool runtime      负责把 draft tool result 写回 WorkingDraft 并记录 ownership
```

主循环形态：

```ts
const action = decideNextAction({
  intent,
  workflowState,
  contextStatus,
  artifactStatus,
  approvalState,
});

if (isTerminalAction(action)) {
  workflowState = applyWorkflowTransition(workflowState, action);
  return renderTerminalResponse(action, workflowState);
}

const toolResult = await runForcedToolStep(action);

workflowState = applyWorkflowTransition(workflowState, action, toolResult);
```

核心 transition 语义：

```ts
function applyWorkflowTransition(
  state: WorkflowState,
  action: WorkflowAction,
  toolResult?: unknown,
): WorkflowState {
  if (action.kind === "block_goal" && state.activeGoal) {
    return {
      ...state,
      activeGoal: {
        ...state.activeGoal,
        status: "blocked",
        blockers: [
          ...state.activeGoal.blockers,
          {
            kind: action.blocker,
            message: action.reason,
          },
        ],
        updatedAt: now(),
      },
    };
  }

  if (action.kind === "compose_patch" && isComposePatchResult(toolResult)) {
    return {
      ...state,
      pendingProposalId: toolResult.proposalId,
      activeGoal: state.activeGoal
        ? {
            ...state.activeGoal,
            status: "awaiting_approval",
            updatedAt: now(),
          }
        : null,
    };
  }

  if (action.kind === "apply_patch" && state.activeGoal) {
    return {
      ...state,
      pendingProposalId: undefined,
      activeGoal: {
        ...state.activeGoal,
        status: "completed",
        updatedAt: now(),
      },
    };
  }

  return state;
}
```

每个 draft mutation tool 必须在自身 runtime 内处理：

```text
stage_query   -> 写 WorkingDraft query + ownership.currentByGoal
stage_view    -> 写 WorkingDraft view + ownership.currentByGoal
stage_binding -> 写 WorkingDraft binding + ownership.currentByGoal
stage_layout  -> 写 WorkingDraft layout + ownership.currentByGoal
apply_patch   -> reset WorkingDraft
```

不要保留未接入生产路径的 `applyDraftMutation` 假边界；如果未来要把 draft mutation reducer 化，必须整体迁移 write tool runtime，而不是并存两套写入语义。

---

# 10. Layout 工具策略

v2.1 采用独立 layout lifecycle，因此 Phase 1 必须新增独立 `upsertLayout`。

不再把 layout 隐藏在 `upsertView` 的可选字段里作为长期方案。

推荐输入：

```ts
type UpsertLayoutToolInput = {
  reason?: string;
  view_id: string;
  layout: {
    desktop: DashboardLayoutItem;
    mobile: DashboardLayoutItem;
  };
};
```

推荐输出：

```ts
type UpsertLayoutToolOutput = {
  summary: string;
  view_id: string;
  layout: {
    desktop: DashboardLayoutItem;
    mobile: DashboardLayoutItem;
  };
};
```

工具约束：

```text
upsertLayout 只修改 WorkingDraft layout
upsertLayout 不修改 ViewSpec renderer/title/description
upsertLayout 必须同时提供 desktop 和 mobile
upsertLayout 必须记录 WorkingDraftOwnership
composePatch 继续把缺少 desktop/mobile layout 视为 hard gate
```

兼容迁移：

```text
旧 upsertView(layout) 可以暂时保留用于 backward compatibility
v2.1 WorkflowAction(stage_layout) 必须调用 upsertLayout
等 v2.1 稳定后，再考虑移除 upsertView 的 layout 写能力或仅保留为内部兼容路径
```

---

# 11. dataMode 不一致处理

`dataModeConsistent=false` 是 hard gate。

MVP 行为：

```text
停止 workflow
不 runCheck
不 composePatch
返回 block_goal(data_mode_mismatch)
要求 runtime 重建或清理该 goal 的 staged artifacts
```

后续版本可以新增：

```ts
| { kind: "repair_artifact"; tool: "repairDraft"; reason: string }
```

但 MVP 不自动 repair，避免把 repair 复杂度混入第一阶段。

典型阻断场景：

```text
goal.dataMode = mock，但 observedDataMode = live
goal.dataMode = live，但 observedDataMode = mock
goal.dataMode = live，但 binding 没有 queryId
goal.dataMode = mock，但 binding 使用 query_column
```

---

# 12. Approval 语义

必须拆成三段：

```text
composePatch   生成 PatchProposal，保存 pending proposal，然后停止
renderApproval UI 展示 proposal，不是模型 tool
applyPatch     用户批准后由 Runtime 强制执行
```

规则：

```text
模型不能调用 applyPatch 来制造审批卡片
普通文本“确认”不能直接 apply
applyPatch 必须依赖 UI approval event 或等价的明确审批状态
applyPatch 必须校验 proposalId 和 baseVersion
applyPatch 成功后 reset WorkingDraft，activeGoal.completed
```

Approval state：

```ts
type ApprovalState = {
  pendingProposalId?: string;
  baseVersion?: number;
  userApproved: boolean;
  source: "none" | "text" | "ui_event";
};
```

规则：

```text
approve_patch_text 只表示用户在聊天中表达了确认意向
approve_patch_text 不能设置 userApproved=true
approve_patch_event 才能设置 userApproved=true
approve_patch_event 必须匹配 proposalId 和 baseVersion
proposalId/baseVersion 不匹配时，不能 applyPatch
```

---

# 13. MVP 流程

## 13.1 explore_data

```text
TurnIntent = explore_data
activeGoal = null
If context missing:
  Action = prepare_data_context
  Tool = getDatasources / getSchemaByDatasource
If context ready:
  Action = answer(data_context_ready)
```

不允许：

```text
创建 WorkingDraft
创建 AuthoringGoal
调用 write tools
```

## 13.2 create_view_live

```text
TurnIntent = create_view
Create activeGoal(status=active, dataMode=live)
prepare_data_context
prepare_query_context
prepare_view_context
stage_query
stage_view
stage_binding
stage_layout
run_check
compose_patch
await_approval
apply_patch after approval event
```

## 13.3 create_view_mock

```text
TurnIntent = create_view
Create activeGoal(status=active, dataMode=mock)
prepare_view_context
stage_view
stage_binding
stage_layout
run_check
compose_patch
await_approval
apply_patch after approval event
```

不允许：

```text
mock 模式调用 upsertQuery
mock 数据藏在 ViewSpec 内部
缺少 binding 就 composePatch
```

## 13.4 approve_patch

```text
TurnIntent = approve_patch_event
approvalState.source = ui_event
approvalState.userApproved = true
pendingProposalId exists
proposalId/baseVersion match
Action = apply_patch
Tool = applyPatch
```

如果只是普通文本确认：

```text
TurnIntent = approve_patch_text
Action = answer / await_approval
不能 apply
```

---

# 14. MVP 测试

必须先覆盖这些纯函数测试：

```text
explore_data -> read tools only, no activeGoal, no draft mutation
explore_data with datasourcesLoaded=true -> answer(data_context_ready), no repeated getDatasources
create_view_live without schema -> prepare_query_context
create_view_live with schema but no query -> stage_query
create_view_live with query/view/binding but no layout -> stage_layout
runCheck failed -> block_goal(check_failed), no repeated run_check
create_view_mock -> no query required
goal.dataMode=mock but artifact observed live -> dataModeConsistent=false
pending approval -> no write tools
approve text without UI approval event -> no applyPatch
approve event with proposal/baseVersion mismatch -> no applyPatch
existing dashboard old query/view -> current goal query.exists=false
schema loaded for another table -> prepare_query_context
chart skill loaded for another chart type -> prepare_view_context(chart)
missing data-format skill before binding -> prepare_view_context(data_format)
stage_layout -> upsertLayout, not upsertView
multiple queries for same goal -> Inspector uses ownership.currentByGoal queryId
```

这些测试应优先替换旧的：

```text
自然语言不路由
缺少数据上下文仍开放 write tools
大工具面 + toolChoice auto
```

---

# 15. 迁移路径

## Phase 1：新增 v2.1 runtime 纯函数和最小工具缺口

```text
resolveIntentV2
createGoalFromIntentV2
resolveDataModeV2
inspectContextStatusV2
inspectArtifactsV2
decideNextActionV2
prepareForcedToolStepV2
applyWorkflowTransitionV2
upsertLayout
```

保留现有工具实现。

Phase 1 acceptance criteria：

```text
WorkflowAction(stage_layout) 可以强制 upsertLayout
WorkingDraft mutation 记录 goal ownership
WorkingDraft ownership 支持 currentByGoal
ContextStatus 匹配当前 goal datasource/table/chartType
ContextStatus 支持 fingerprint/version/loadedAt 失效判断
dataModeConsistent=false 会 block_goal，不会继续 check/compose
runtimeCheck failed 会 block_goal(check_failed)，不会重复 run_check
approve_patch_text 和 approve_patch_event 分离，只有 event 可 applyPatch
```

## Phase 2：接入 prepareStep

在 `agent.ts prepareStep` 中增加 v2.1 路径：

```ts
const intent = resolveIntentV2(...);
const workflowState = reduceIntentToWorkflowStateV2(...);
const contextStatus = inspectContextStatusV2(...);
const artifactStatus = inspectArtifactsV2(...);
const action = decideNextActionV2(...);
return prepareForcedToolStepV2(action);
```

早期可以保留旧链路 fallback，但 v2.1 覆盖 MVP 后应删除 fallback。

## Phase 3：收口旧流程控制源

完成后源码中只允许 v2 runtime 决定下一步；旧的 draft/status/prompt/scope 流程控制职责必须删除或降级为事实/能力描述：

```text
draft status 只输出事实
workflow runtime 只使用 decideNextActionV2
task state 不保存流程阶段
prompt 不描述下一步工具
scope 只提供 capability / page boundary
```

---

# 16. 最终判断

v2.1 比当前架构明显更稳。

当前系统的主要问题是流程控制权分散：

```text
scope.ts
taskState
draftStatus
lifecycleDecision
prompt
model
```

v2.1 收敛为：

```text
decideNextAction(input) -> WorkflowAction
prepareForcedToolStep(action) -> activeTools + toolChoice
```

只要坚持：

```text
Goal 不记录临时步骤
下一步永远由 decideNextAction 纯函数推导
```

就能避免把旧 `phase` 问题换个名字搬到新架构里。
