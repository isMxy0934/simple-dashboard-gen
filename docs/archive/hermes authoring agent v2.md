你说得对，刚才我放到了旁边的 canvas，但你这边没看到。下面我直接把**文档正文**贴出来，你可以复制给工程师讨论。

设计依据上，我参考的是这几个方向：AI SDK 支持 `toolChoice / activeTools / stopWhen` 这类多步工具调用控制，说明 agent 流程不能只靠 prompt 自觉继续；MCP 也明确区分 Resources、Prompts、Tools，适合借鉴到 Hermes 的 schema / prompt / tool 边界设计。([AI SDK][1])

---

# Hermes Authoring Agent v2 架构设计草案

## 0. 文档目的

本文档用于讨论 **Hermes Authoring Agent** 的重新设计方案。

当前系统的目标不是做一个“传统 dashboard builder + AI 辅助填表单”，而是做一个 **agent-native 的报表创作系统**。

用户通过自然语言提出分析目标，Hermes Agent 通过工具创建、检查、修改、提交 dashboard。

核心目标：

```text
用户说出分析意图
  -> Agent 通过 tools 生成 query / view / binding / layout
  -> 系统 run check
  -> 生成 patch proposal
  -> 用户审批
  -> apply 到 dashboard document
```

---

# 1. 当前问题总结

当前系统混乱的根因不是某个单点 bug，而是：

> **流程控制权分散。**

现在多个模块都在部分承担流程控制职责：

```text
scope.ts            决定开放哪些工具
taskState           保存 phase / dataMode / goalSummary
draftStatus         检查 artifact 是否完整，同时输出 next action
lifecycleDecision   尝试强制部分工具
prompt              要求模型继续执行
model               自己决定是否继续调用工具
```

这导致系统没有一个唯一的流程控制中心。

---

## 1.1 典型问题

### 问题一：探索和创建边界不清

用户说：

```text
先帮我看看有哪些可用数据
```

这应该是探索，只读 schema，不应该创建图表。

用户说：

```text
我们先做一个周趋势，看看销售额怎么样
```

这应该是创建，应该进入：

```text
stage_query -> stage_view -> stage_binding -> run_check -> compose_patch
```

但当前系统容易把两类请求都放进类似 `author-dashboard` 模式。

---

### 问题二：用户明确创建后，状态仍可能 idle

当前可能出现：

```json
{
  "phase": "idle",
  "goalSummary": "我们先做一个周趋势看看销售额怎么样"
}
```

这说明 `phase` 不是严格状态机，只是一个松散字段。

在一个真正的 authoring workflow 中，这是非法状态。

---

### 问题三：`has_draft=false` 含义混乱

当前：

```text
has_draft = false
```

可能表示：

```text
1. 用户只是聊天，没有任务
2. 用户已经要求创建，但还没开始生成草稿
```

这两个含义不能混在一起。

正确做法是：

```text
有没有 activeGoal      表示有没有创作任务
有没有 workingDraft    表示有没有草稿 artifact
```

---

### 问题四：dataMode 从 artifact 反推

当前可能通过：

```text
有 query -> live
有 mock binding -> mock
有 view 但没 binding -> undecided
```

来反推 dataMode。

正确顺序应该是：

```text
用户意图 + 当前数据上下文
  -> 决定 dataMode
  -> 再决定需要哪些 artifact
```

也就是：

```text
Intent + Context -> DataMode -> Artifact Lifecycle
```

而不是：

```text
Artifact -> infer DataMode
```

---

### 问题五：prompt 承担太多流程职责

prompt 可以告诉模型：

```text
不要只 loadSkill 后结束
mock/live 都要 binding
用户确认图表后要继续创建
```

但 prompt 是软约束。

系统稳定性不能依赖模型“自觉继续”。

流程完整性必须由代码层保证。

---

# 2. 新设计核心结论

Hermes v2 应该采用以下职责分离：

```text
Agent                负责聪明：理解需求、生成 SQL、生成 view、解释错误
Workflow Runtime     负责稳定：决定下一步做什么，强制哪个 tool，何时停止
Artifact Inspector   负责体检：检查 query / view / binding / check / patch 是否完整
Tools                负责执行：读 schema、写 draft、run check、compose/apply patch
DashboardDocument    负责事实：保存已发布 dashboard
WorkingDraft         负责草稿：保存待提交 artifact
PatchProposal        负责审批：展示将要修改什么
Conversation         负责对话：保存 UIMessage，不作为 dashboard 事实源
```

新系统主链路：

```text
User Message
  -> Intent Resolver
  -> Authoring Goal Manager
  -> Data Mode Resolver
  -> Artifact Inspector
  -> Workflow Controller
  -> Forced Tool Step
  -> Working Draft / Check / Patch
  -> Human Approval
  -> Apply to DashboardDocument
```

核心原则：

> **Agent 负责生成内容，Workflow Runtime 负责推进流程。**

不能让 Agent 同时负责：

```text
理解用户想做什么
决定下一步做什么
决定什么时候停
决定什么时候检查
决定什么时候提交
```

---

# 3. 产品定义

## 3.1 Hermes Authoring Agent 是什么

Hermes Authoring Agent 是一个通过 tools 创建报表的 agent 系统。

用户不直接操作 query / view / binding，而是通过自然语言提出分析目标：

```text
先看看有哪些数据
public.sales_weekly_fact 可以做什么分析
我们先做一个 GMV 周趋势图
把这个图改成按地区对比
先用 mock 数据占位
确认，应用这个修改
```

Hermes 负责把用户意图转成 dashboard artifact：

```text
QueryDef -> BindingSpec -> ViewSpec -> LayoutSpec
```

并在 apply 前经过：

```text
Runtime Check -> Patch Proposal -> Human Approval
```

---

## 3.2 v2 第一阶段非目标

第一阶段不做：

```text
多 agent handoff
复杂多图 dashboard 自动规划
高级图表推荐系统
自动实盘发布
未经用户审批直接修改 dashboard
让模型自由决定完整流程是否继续
```

第一阶段目标：

> **把单图创建链路跑稳定。**

---

# 4. 核心对象模型

## 4.1 DashboardDocument

`DashboardDocument` 是已保存、已发布的 dashboard 事实源。

```ts
type DashboardDocument = {
  id: string;
  name: string;

  views: Record<string, ViewSpec>;
  queryDefs: Record<string, QueryDef>;
  bindings: Record<string, BindingSpec>;
  layouts: Record<string, LayoutSpec>;

  version: number;
  updatedAt: string;
};
```

原则：

```text
用户审批前，不直接修改 DashboardDocument
所有修改先进入 WorkingDraft
applyPatch 后才写入 DashboardDocument
```

---

## 4.2 WorkingDraft

`WorkingDraft` 是当前会话中的候选修改。

```ts
type WorkingDraft = {
  id: string;
  baseDashboardId: string;
  baseVersion: number;

  stagedQueries: Record<string, QueryDef>;
  stagedViews: Record<string, ViewSpec>;
  stagedBindings: Record<string, BindingSpec>;
  stagedLayouts: Record<string, LayoutSpec>;

  dirtyQueryIds: string[];
  dirtyViewIds: string[];
  dirtyBindingIds: string[];
  dirtyLayoutIds: string[];

  createdAt: string;
  updatedAt: string;
};
```

原则：

```text
WorkingDraft 只保存待提交 artifact
不保存用户意图
不判断下一步动作
不负责审批
```

---

## 4.3 QueryDef

`QueryDef` 负责真实数据查询。

```ts
type QueryDef = {
  id: string;
  datasourceId: string;
  sql: string;

  params?: Record<string, unknown>;

  expectedColumns?: Array<{
    name: string;
    type: "string" | "number" | "date" | "datetime" | "boolean";
  }>;
};
```

原则：

```text
live 模式必须有 query
mock 模式不需要 query
query 不负责 view 展示逻辑
```

---

## 4.4 ViewSpec

`ViewSpec` 负责描述图表结构和 required slots。

```ts
type ViewSpec = {
  id: string;

  type: "line" | "bar" | "table" | "kpi" | "area" | "pie";

  title: string;

  slots: Record<string, {
    required: boolean;
    valueType: "string" | "number" | "date" | "array";
    description?: string;
  }>;

  renderSpec: Record<string, unknown>;
};
```

原则：

```text
View 不隐式取数
View 只声明自己需要哪些 slots
所有 required slots 必须由 binding 提供
```

---

## 4.5 BindingSpec

`BindingSpec` 负责把 query result 或 mock data 接到 view slots。

```ts
type BindingSpec = {
  id: string;
  viewId: string;

  mode: "live" | "mock";

  queryId?: string;

  slotBindings: Record<string, {
    source:
      | { kind: "query_column"; column: string }
      | { kind: "query_expression"; expression: string }
      | { kind: "mock_value"; value: unknown };
  }>;
};
```

原则：

```text
live chart 必须有 queryId
mock chart 不需要 queryId，但仍然必须有 binding
mock 数据不能藏在 view 内部
binding 是 view 数据入口的唯一来源
```

---

## 4.6 PatchProposal

`PatchProposal` 是用户审批对象。

```ts
type PatchProposal = {
  id: string;
  baseDashboardId: string;
  baseVersion: number;

  summary: string;

  changes: Array<
    | { op: "upsert_query"; query: QueryDef }
    | { op: "upsert_view"; view: ViewSpec }
    | { op: "upsert_binding"; binding: BindingSpec }
    | { op: "upsert_layout"; layout: LayoutSpec }
    | { op: "delete_query"; queryId: string }
    | { op: "delete_view"; viewId: string }
    | { op: "delete_binding"; bindingId: string }
  >;

  createdAt: string;
};
```

原则：

```text
patch 是审批边界
composePatch 后必须停下来等用户批准
applyPatch 必须显式由用户确认触发
```

---

# 5. Intent Layer

## 5.1 TurnIntent

`TurnIntent` 表示用户这一轮到底想做什么。

```ts
type TurnIntent =
  | { kind: "chat" }
  | { kind: "explore_data"; target?: DataTarget }
  | { kind: "advise_analysis"; target?: DataTarget }
  | { kind: "create_view"; goal: ViewGoal }
  | { kind: "revise_view"; targetViewId?: string; goal: RevisionGoal }
  | { kind: "create_dashboard"; goal: DashboardGoal }
  | { kind: "approve_patch"; decision: "approve" | "reject" | "revise" }
  | { kind: "repair_draft"; reason?: string };
```

---

## 5.2 Intent Resolver 职责

负责：

```text
判断用户是在探索、咨询、创建、修改、审批，还是普通聊天
抽取 metric / dimension / time grain / chart type / datasource hints
给出置信度和歧义点
```

不负责：

```text
创建 query
创建 view
调用 tools
判断 artifact 是否完整
决定下一步 workflow action
```

---

## 5.3 Intent 示例

用户：

```text
先帮我看看有哪些可用数据
```

输出：

```ts
{ kind: "explore_data" }
```

用户：

```text
我们先做一个周趋势，看看销售额怎么样
```

输出：

```ts
{
  kind: "create_view",
  goal: {
    chartType: "line",
    metrics: ["sales_amount"],
    timeGrain: "week"
  }
}
```

用户：

```text
确认，应用这个修改
```

输出：

```ts
{ kind: "approve_patch", decision: "approve" }
```

---

# 6. Authoring Goal Layer

## 6.1 为什么需要 AuthoringGoal

`TurnIntent` 是单轮意图。

`AuthoringGoal` 是跨 step / 跨 turn 的创作任务。

例如用户说：

```text
我们先做一个周趋势，看看销售额怎么样
```

系统应该创建：

```ts
activeGoal = {
  kind: "create_view",
  status: "ready_to_draft",
  summary: "创建销售额周趋势图",
  dataMode: "live"
}
```

不能再出现：

```ts
phase = "idle"
goalSummary = "创建销售额周趋势图"
```

---

## 6.2 AuthoringGoal 类型

```ts
type AuthoringGoal = {
  id: string;

  kind:
    | "create_view"
    | "revise_view"
    | "create_dashboard"
    | "repair_draft";

  status:
    | "new"
    | "resolving_data"
    | "ready_to_draft"
    | "staging_query"
    | "staging_view"
    | "staging_binding"
    | "checking"
    | "composing_patch"
    | "awaiting_approval"
    | "completed"
    | "blocked"
    | "failed";

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
    bindingId?: string;
  };

  blockers: Array<{
    kind:
      | "missing_datasource"
      | "missing_metric"
      | "missing_dimension"
      | "ambiguous_data_mode"
      | "check_failed"
      | "needs_user_confirmation";
    message: string;
  }>;
};
```

---

## 6.3 AuthoringGoal 不变量

必须满足：

```text
没有 activeGoal，表示当前没有创作任务
有 activeGoal，Workflow 必须推进它，或者明确 blocked
activeGoal.status = completed 后，不再继续 stage artifact
activeGoal.status = awaiting_approval 时，只能等待用户 approve / reject / revise
activeGoal.dataMode = undecided 时，不能 stage query/view/binding，必须先 inspect data 或 ask user
```

---

# 7. Data Mode 决策

## 7.1 dataMode 定义

```ts
type DataMode = "live" | "mock" | "undecided";
```

含义：

```text
live       使用真实数据源，必须创建 query + view + binding
mock       使用 mock 数据占位，必须创建 view + binding，不需要 query
undecided  信息不足，不能开始创建 artifact
```

---

## 7.2 决策原则

```text
用户明确说真实数据 / 基于某表 / 查询某指标 -> live
用户明确说占位 / 示例 / mock -> mock
用户想建图，但数据源、指标、表都不清楚 -> undecided
系统有明确 selected datasource/table，且用户要求建图 -> 默认 live
```

---

# 8. Artifact Inspector

## 8.1 职责

Artifact Inspector 只检查当前草稿的事实状态。

它不判断用户意图，不决定下一步动作。

---

## 8.2 ArtifactStatus 类型

```ts
type ArtifactStatus = {
  hasDraft: boolean;

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

---

## 8.3 明确禁止

Artifact Inspector 不应该输出：

```ts
next_required_action
```

因为 next action 是 Workflow Controller 的职责。

---

# 9. Workflow Controller

## 9.1 职责

Workflow Controller 是整个系统唯一的流程控制器。

输入：

```ts
type WorkflowInput = {
  intent: TurnIntent;
  activeGoal: AuthoringGoal | null;
  artifactStatus: ArtifactStatus;
  lastCheckResult?: RuntimeCheckResult;
  approvalState?: ApprovalState;
};
```

输出唯一动作：

```ts
type WorkflowAction =
  | { kind: "answer"; reason: string }
  | { kind: "ask_user"; question: string; blocker: string }
  | { kind: "inspect_data"; tool: "getDatasources" | "getSchemaByDatasource" }
  | { kind: "stage_query"; tool: "upsertQuery" }
  | { kind: "stage_view"; tool: "upsertView" }
  | { kind: "stage_binding"; tool: "upsertBinding" }
  | { kind: "run_check"; tool: "runCheck" }
  | { kind: "compose_patch"; tool: "composePatch" }
  | { kind: "await_approval" }
  | { kind: "apply_patch"; tool: "applyPatch" }
  | { kind: "repair"; tool: "repairDraft" };
```

---

## 9.2 不允许 `none`

不要再使用：

```ts
next_required_action = "none"
```

因为它混合了三种含义：

```text
真的没事做
任务已完成
系统没识别出下一步
```

应该显式使用：

```ts
{ kind: "answer", reason: "chat_only" }
{ kind: "await_approval" }
{ kind: "ask_user", blocker: "ambiguous_data_mode" }
{ kind: "invalid_state", reason: "active_goal_missing" }
```

---

# 10. Tool Forcing 策略

## 10.1 原则

所有 artifact lifecycle action 都必须强制工具。

```text
stage_query   -> toolChoice = upsertQuery
stage_view    -> toolChoice = upsertView
stage_binding -> toolChoice = upsertBinding
run_check     -> toolChoice = runCheck
compose_patch -> toolChoice = composePatch
apply_patch   -> toolChoice = applyPatch
```

不能只强制：

```text
stage_binding
run_check
compose_patch
```

否则模型仍然可能在 `stage_query` 或 `stage_view` 之前停掉。

---

## 10.2 工具开放策略

每一步只开放必要工具。

例如 `stage_query`：

```ts
activeTools = ["upsertQuery", "getSchemaByDatasource"];
toolChoice = "upsertQuery";
```

例如 `run_check`：

```ts
activeTools = ["runCheck"];
toolChoice = "runCheck";
```

例如 `compose_patch`：

```ts
activeTools = ["composePatch"];
toolChoice = "composePatch";
```

这样模型不会随意跳步骤。

---

# 11. 主流程设计

## 11.1 explore_data

用户：

```text
先帮我看看有哪些可用数据
```

流程：

```text
Intent = explore_data
activeGoal = null
WorkflowAction = inspect_data
Tool = getDatasources / getSchemaByDatasource
Final = answer
```

特点：

```text
不创建 WorkingDraft
不创建 AuthoringGoal
不调用 upsert 工具
```

---

## 11.2 create_view_live

用户：

```text
我们先做一个周趋势，看看销售额怎么样
```

前提：系统能识别可用 datasource/table/metric。

流程：

```text
Intent = create_view
Create AuthoringGoal
DataMode = live
Inspect ArtifactStatus
NextAction = stage_query
Force upsertQuery
NextAction = stage_view
Force upsertView
NextAction = stage_binding
Force upsertBinding
NextAction = run_check
Force runCheck
NextAction = compose_patch
Force composePatch
NextAction = await_approval
Stop and ask user to approve
```

---

## 11.3 create_view_mock

用户：

```text
先用示例数据做一个销售趋势图
```

流程：

```text
Intent = create_view
Create AuthoringGoal
DataMode = mock
NextAction = stage_view
Force upsertView
NextAction = stage_binding
Force upsertBinding with mock data
NextAction = run_check
Force runCheck
NextAction = compose_patch
Force composePatch
NextAction = await_approval
```

特点：

```text
不创建 query
仍然必须创建 binding
mock data 不允许藏在 view 内
```

---

## 11.4 approve_patch

用户：

```text
确认，应用这个修改
```

流程：

```text
Intent = approve_patch

If pending proposal exists:
  NextAction = apply_patch
  Force applyPatch
  Mark goal completed

Else:
  answer no pending proposal
```

---

# 12. Runtime 主循环伪代码

```ts
export async function runAuthoringTurn(input: AuthoringTurnInput) {
  const conversation = await loadConversation(input.conversationId);
  const dashboard = await loadDashboard(input.dashboardId);
  let workflowState = await loadWorkflowState(input.conversationId);
  let draft = await loadWorkingDraft(input.conversationId);

  const intent = await resolveIntent({
    latestUserMessage: input.message,
    conversationSummary: conversation.summary,
    dashboardSummary: summarizeDashboard(dashboard),
    activeGoal: workflowState.activeGoal,
  });

  workflowState = reduceIntentToWorkflowState({
    intent,
    workflowState,
  });

  for (let step = 0; step < MAX_WORKFLOW_STEPS; step++) {
    const artifactStatus = inspectArtifacts({
      dashboard,
      draft,
      activeGoal: workflowState.activeGoal,
    });

    const action = decideNextAction({
      intent,
      workflowState,
      artifactStatus,
    });

    if (action.kind === "answer") {
      return generateFinalAnswer({ intent, workflowState, artifactStatus });
    }

    if (action.kind === "ask_user") {
      return askUser(action.question);
    }

    if (action.kind === "await_approval") {
      return renderPatchProposal(workflowState.pendingProposal);
    }

    const stepResult = await runForcedToolStep({
      action,
      workflowState,
      dashboard,
      draft,
      conversation,
    });

    workflowState = applyWorkflowTransition({
      workflowState,
      action,
      stepResult,
    });

    draft = applyDraftMutation({
      draft,
      action,
      stepResult,
    });

    await saveWorkflowState(workflowState);
    await saveWorkingDraft(draft);
  }

  return failSafely("workflow_step_limit_exceeded");
}
```

---

# 13. `decideNextAction` 示例

```ts
export function decideNextAction(input: {
  intent: TurnIntent;
  workflowState: WorkflowState;
  artifactStatus: ArtifactStatus;
}): WorkflowAction {
  const { intent, workflowState, artifactStatus } = input;

  if (intent.kind === "chat") {
    return { kind: "answer", reason: "chat_only" };
  }

  if (intent.kind === "explore_data") {
    return { kind: "inspect_data", tool: "getDatasources" };
  }

  if (intent.kind === "approve_patch") {
    if (intent.decision === "approve" && workflowState.pendingProposalId) {
      return { kind: "apply_patch", tool: "applyPatch" };
    }

    return {
      kind: "answer",
      reason: "no_applicable_patch_or_not_approved",
    };
  }

  const goal = workflowState.activeGoal;

  if (!goal) {
    return {
      kind: "ask_user",
      blocker: "missing_active_goal",
      question: "我还没有明确要创建或修改哪个报表对象。",
    };
  }

  if (goal.dataMode === "undecided") {
    return {
      kind: "ask_user",
      blocker: "ambiguous_data_mode",
      question: "这个图表要使用真实数据，还是先用 mock 数据占位？",
    };
  }

  if (goal.dataMode === "live" && !artifactStatus.query.exists) {
    return { kind: "stage_query", tool: "upsertQuery" };
  }

  if (!artifactStatus.view.exists) {
    return { kind: "stage_view", tool: "upsertView" };
  }

  if (!artifactStatus.binding.exists || artifactStatus.binding.missingSlots.length > 0) {
    return { kind: "stage_binding", tool: "upsertBinding" };
  }

  if (
    artifactStatus.runtimeCheck.required &&
    artifactStatus.runtimeCheck.status !== "passed"
  ) {
    return { kind: "run_check", tool: "runCheck" };
  }

  if (!artifactStatus.patch.composed || artifactStatus.patch.stale) {
    return { kind: "compose_patch", tool: "composePatch" };
  }

  return { kind: "await_approval" };
}
```

---

# 14. Tool Registry 设计

## 14.1 Read Tools

```text
getDatasources
getSchemaByDatasource
getDashboardSummary
getView
getQuery
getBinding
```

职责：

```text
读取上下文
不修改状态
不创建 draft
```

---

## 14.2 Draft Tools

```text
upsertQuery
upsertView
upsertBinding
upsertLayout
deleteQuery
deleteView
deleteBinding
```

职责：

```text
修改 WorkingDraft
```

限制：

```text
不直接修改 DashboardDocument
不直接 compose patch
不判断 workflow 下一步
```

---

## 14.3 Check Tools

```text
runCheck
```

职责：

```text
检查 SQL 是否可执行
检查 query result columns 是否匹配 binding
检查 binding 是否覆盖 required slots
检查 renderer 是否能渲染 view
```

---

## 14.4 Patch Tools

```text
composePatch
applyPatch
```

职责：

```text
composePatch：从 WorkingDraft 生成 PatchProposal
applyPatch：用户批准后应用到 DashboardDocument
```

限制：

```text
composePatch 后必须等待审批
applyPatch 必须有 pending proposal
applyPatch 必须验证 baseVersion，避免覆盖并发修改
```

---

# 15. Prompt 职责降级

Prompt 只负责：

```text
如何生成高质量 SQL
如何生成合理 ViewSpec
如何生成 BindingSpec
如何解释错误
如何给用户清晰反馈
```

Prompt 不负责：

```text
是否创建 activeGoal
是否进入 stage_query
是否继续 stage_view
是否必须 binding
是否 runCheck
是否 composePatch
是否 await approval
```

这些必须由 Workflow Runtime 保证。

---

# 16. 推荐代码目录

```text
authoring/
  runtime/
    runAuthoringTurn.ts
    runWorkflowLoop.ts
    runForcedToolStep.ts
    prepareStep.ts

  intent/
    intent.schema.ts
    resolveIntent.ts

  goal/
    authoringGoal.schema.ts
    createGoalFromIntent.ts
    updateGoalFromToolResult.ts

  workflow/
    workflowState.schema.ts
    workflowAction.schema.ts
    decideNextAction.ts
    applyWorkflowTransition.ts

  artifacts/
    dashboardDocument.schema.ts
    workingDraft.schema.ts
    inspectArtifacts.ts
    validateBindingCoverage.ts
    validateViewSlots.ts

  tools/
    readTools.ts
    draftTools.ts
    checkTools.ts
    patchTools.ts
    toolRegistry.ts

  prompts/
    buildSystemPrompt.ts
    buildStepPrompt.ts

  approval/
    patchProposal.schema.ts
    composePatch.ts
    applyPatch.ts
```

---

# 17. MVP 范围

v2 第一阶段只做 4 条链路：

```text
1. explore_data
2. create_view_live
3. create_view_mock
4. approve_patch
```

暂时不做：

```text
revise_view
repair_draft
create_dashboard 多图规划
复杂 layout 自动优化
多 agent handoff
```

原因：

```text
先把单图创建跑稳定
先验证 Query -> Binding -> View 的 artifact contract
先验证 human approval 和 patch application
后续再扩展 revise 和 repair
```

---

# 18. 回归测试 Case

## Case 1：探索数据

输入：

```text
先帮我看看有哪些可用数据
```

期望：

```text
Intent = explore_data
No activeGoal
No workingDraft mutation
Call read tools only
Return datasource/schema summary
```

---

## Case 2：创建 live 图表

输入：

```text
我们先做一个周趋势，看看销售额怎么样
```

期望：

```text
Intent = create_view
Create activeGoal
DataMode = live
Force upsertQuery
Force upsertView
Force upsertBinding
Force runCheck
Force composePatch
Stop at awaiting_approval
```

---

## Case 3：创建 mock 图表

输入：

```text
先用 mock 数据做一个 GMV 周趋势图
```

期望：

```text
Intent = create_view
DataMode = mock
No query required
Force upsertView
Force upsertBinding with mock values
Force runCheck
Force composePatch
Stop at awaiting_approval
```

---

## Case 4：数据不明确

输入：

```text
帮我做一个趋势图
```

如果没有 selected datasource/table：

```text
Intent = create_view
DataMode = undecided
No draft mutation
Ask user or inspect data
```

---

## Case 5：审批应用

输入：

```text
确认，应用这个修改
```

期望：

```text
Intent = approve_patch

If pending proposal exists:
  Force applyPatch
  Mark activeGoal completed

Else:
  answer no pending proposal
```

---

# 19. 需要和工程师讨论的问题

## 19.1 IntentResolver 用规则还是 LLM structured output？

建议：混合。

```text
明确审批词：规则优先
明确探索词：规则优先
创建/修改图表：LLM structured output
低置信度时进入 ask_user
```

---

## 19.2 Workflow loop 一轮最多跑几步？

建议：

```text
MAX_WORKFLOW_STEPS = 8
```

足够覆盖：

```text
stage_query -> stage_view -> stage_binding -> run_check -> compose_patch
```

并保留少量修复空间。

---

## 19.3 runCheck 失败后第一版要不要自动 repair？

建议第一版不要自动复杂 repair。

MVP 行为：

```text
runCheck failed
  -> 给用户解释失败原因
  -> 标记 activeGoal blocked
```

第二阶段再加：

```text
runCheck failed
  -> repair once
  -> runCheck again
  -> still failed then blocked
```

---

## 19.4 layout 是否必须第一版自动生成？

建议：要有最小 layout。

否则 patch 应用后 view 没有位置。

第一版可以固定：

```text
x = 0
y = next available row
w = 6 or 12
h = 4
```

---

## 19.5 ViewSpec 要不要直接等于 ECharts option？

建议不要完全等于。

推荐：

```text
ViewSpec = 稳定业务图表 contract
renderSpec.echartsOption = 渲染器细节
```

原因：

```text
Binding 需要稳定 slots
ECharts option 太自由，不适合直接作为 AI 主 contract
后续可能支持其他 renderer
```

---

# 20. 最终建议

彻底重构是合理的。

但不是全部推翻。

建议保留：

```text
DashboardDocument / ViewSpec / QueryDef / BindingSpec 的已有可用部分
具体 tool execute 的底层逻辑
runCheck 的底层能力
compose/apply patch 的已有部分
```

建议重写：

```text
scope.ts 职责
旧 taskState phase 设计
draftStatus.next_required_action
lifecycleDecision
prompt 中承担流程控制的部分
```

最终核心链路应该是：

```text
Intent
  -> Goal
  -> ArtifactStatus
  -> WorkflowAction
  -> ForcedTool
  -> Draft / Check / Patch
```

一句话总结：

> **Agent 负责生成内容，Workflow Runtime 负责保证流程一定完整、安全、可恢复。**

[1]: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling?utm_source=chatgpt.com "AI SDK Core: Tool Calling"
