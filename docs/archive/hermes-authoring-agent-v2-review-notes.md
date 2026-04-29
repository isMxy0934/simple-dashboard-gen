# Hermes Authoring Agent v2 审核材料：现状代码与风险点

本文用于给工程审核 Hermes Authoring Agent v2 设计草案。结论不是否定 v2，恰恰相反：v2 的主方向是合理的，尤其是把流程控制权从 prompt/model 中收回到 Runtime。

但当前代码里已经有若干地方会和 v2 的目标冲突；同时 v2 草案也有几个需要补强的点。下面按“现有代码证据 -> 为什么不合理 -> 建议”列出。

## 1. 当前 `scope.ts` 仍是大工具面 + `auto`

现有代码：

- `src/ai/authoring/scope.ts:198-260`
- `src/ai/authoring/scope.ts:288-380`
- `tests/authoring-reliability.test.ts:707-739`

现状：

```ts
case "author-dashboard":
  return {
    mode: "author-dashboard",
    activeTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS),
    toolChoice: "auto",
  };
```

测试还明确保护了这种行为：

```ts
assert.equal(decision.activeTools.includes("upsertView"), true);
assert.equal(decision.activeTools.includes("upsertQuery"), true);
assert.equal(decision.toolChoice, "auto");
```

不合理点：

`scope.ts` 当前主要决定“开放哪些工具”，而不是决定“下一步唯一动作”。这意味着模型仍然可以在一堆工具里自由选择，也可以选择停下。v2 想要的是：

```text
WorkflowAction = stage_query
activeTools = ["upsertQuery"]
toolChoice = { type: "tool", toolName: "upsertQuery" }
```

建议：

`scope.ts` 应降级为 scope / permission resolver，只回答 dashboard/focused/chat/explore/approval 的权限边界。具体下一步工具由新的 `WorkflowController.decideNextAction()` 决定。

## 2. 当前系统刻意不从自然语言识别 authoring intent

现有代码：

- `src/ai/authoring/scope.ts:42-49`
- `src/ai/authoring/scope.ts:288-290`
- `tests/authoring-reliability.test.ts:724-739`

现状：

```ts
export function resolveAuthoringIntent(
  _latestUserText: string,
  explicitIntent?: AuthoringIntent | null,
): AuthoringIntent {
  return explicitIntent ?? "author";
}
```

测试明确要求：

```ts
assert.equal(resolveAuthoringIntent("应用"), "author");
assert.equal(resolveAuthoringIntent("取消"), "author");
assert.equal(resolveAuthoringIntent("看看有哪些数据"), "author");
```

不合理点：

这和 v2 的 `Intent Resolver` 目标冲突。用户说“看看有哪些数据”和“帮我做周趋势图”，在代码层目前都可能落到 authoring 工具面，再靠 prompt/model 判断是否写 draft。

建议：

新增结构化 `TurnIntent`，至少覆盖：

```ts
chat | explore_data | advise_analysis | create_view | approve_patch
```

审批、探索、取消这类高确定性意图优先规则识别；创建/修改类可以用 LLM structured output，低置信度进入 `ask_user`。

## 3. `taskState` 是松散 phase，不是严格创作目标

现有代码：

- `src/ai/authoring/contracts/session-state.ts:34-44`
- `src/ai/authoring/contracts/session-state.ts:84-95`
- `src/ai/authoring/task-state.ts:65-90`

现状：

```ts
export interface AuthoringTaskStateSnapshot {
  phase: AuthoringTaskPhase;
  dataMode?: AuthoringDataMode;
  goalSummary?: string;
  selectedDataContext?: { datasourceId?: string; tableName?: string; reason?: string };
}
```

`updateTaskStateFromUserTurn()` 的 phase 更新逻辑：

```ts
const phase = input.hasPendingApproval
  ? "awaiting_approval"
  : previous.lastFailedTool
    ? "recovering_tool_error"
    : input.hasWorkingDraft
    ? "drafting"
    : previous.phase;
```

不合理点：

用户已经明确说“做一个周趋势图”，如果当前没有 working draft，phase 仍可能停留在之前的状态。`goalSummary` 只是文本摘要，不代表一个可推进、可验证、可恢复的 active goal。

建议：

新增 `AuthoringGoal`，并把创作任务和 draft 分开：

```ts
activeGoal: AuthoringGoal | null
workingDraft: WorkingDraft | null
```

有 `activeGoal` 时，Workflow 必须推进、等待用户、或显式 blocked；不能只靠 `phase + goalSummary`。

## 4. `dataMode` 仍有 artifact 反推路径

现有代码：

- `src/ai/authoring/tools/draft-status.ts:49-77`
- `src/ai/authoring/compose-readiness.ts:34-48`
- `src/ai/authoring/task-state.ts:49-63`

现状：

```ts
if ((input.draft?.queryDefs?.length ?? 0) > 0 || dirtyQueryIds.size > 0) {
  return "live";
}
if (relevantBindings.some((binding) => bindingMode(binding) === "mock")) {
  return "mock";
}
return input.hasStagedViews ? "undecided" : ...
```

不合理点：

v2 文档提出的正确方向是：

```text
Intent + Context -> DataMode -> Artifact Lifecycle
```

当前实现仍然有：

```text
Artifact -> infer DataMode
```

这会导致流程晚一步才发现问题，也会让 mock/live 变成 draft 副产物，而不是 goal 级决策。

建议：

`dataMode` 应由 `DataModeResolver` 在创建/更新 `AuthoringGoal` 时确定。Artifact Inspector 可以报告实际 binding/query 是否和 goal 的 dataMode 一致，但不应该反向决定目标 dataMode。

## 5. `draftStatus` 同时做体检和下一步决策

现有代码：

- `src/ai/authoring/tools/draft-status.ts:220-260`
- `src/ai/authoring/tools/draft-status.ts:262-383`
- `src/ai/authoring/contracts/tool-io.ts:126-168`

现状：

`DraftStatusToolOutput` 包含：

```ts
next_required_action: AuthoringNextAction;
can_compose: boolean;
blockers: ...
```

并且 `resolveNextRequiredAction()` 直接输出：

```ts
"stage_query" | "stage_view" | "stage_binding" | "run_check" | "compose_patch" | "none"
```

不合理点：

这让 Artifact Inspector 变成了半个 Workflow Controller。体检模块本来应该只回答“当前 artifact 是否完整/有效”，不应该回答“下一步该做什么”。

建议：

把 `next_required_action` 移出 Inspector。Inspector 输出事实：

```ts
query.exists / query.valid
view.exists / view.valid
binding.missingSlots
runtimeCheck.status
patch.composed
```

唯一下一步由 `decideNextAction(intent, activeGoal, artifactStatus, approvalState)` 输出。

## 6. 当前 `has_query/has_view` 是全局判断，容易误判当前目标已完成

现有代码：

- `src/ai/authoring/tools/draft-status.ts:275-277`

现状：

```ts
const hasQuery = input.candidate.query_defs.length > 0;
const hasView = input.candidate.dashboard_spec.views.length > 0;
```

不合理点：

如果 dashboard 已经有旧 query/view，当前新目标“新增 GMV 周趋势图”还没 stage query，`hasQuery=true` 也可能让流程误以为 query 已存在。

建议：

ArtifactStatus 必须按 `activeGoal.targetRefs` 或本轮 dirty ids scoped 计算，例如：

```ts
query.exists = goal.targetRefs.queryId
  ? candidate.query_defs.some(q => q.id === goal.targetRefs.queryId)
  : dirtyQueryIds.length > 0;
```

不能用 dashboard 全局是否有任意 query/view 作为当前目标完成状态。

## 7. 生命周期只强制了后半段，`stage_query` / `stage_view` 仍靠模型自觉

现有代码：

- `src/ai/authoring/draft-completion.ts:324-355`
- `src/ai/authoring/draft-completion.ts:357-377`

现状：

强制工具只覆盖：

```ts
stage_binding -> upsertBinding
run_check -> runCheck
compose_patch -> composePatch
```

而其他阶段落到：

```ts
const activeTools = draftingTools(input.tools);
toolChoice: activeTools.length > 0 ? "auto" : "none";
```

不合理点：

这正是 v2 文档指出的风险：模型可能在 `stage_query` 或 `stage_view` 前后停下，或者在多个开放工具里跳步骤。

建议：

所有 artifact lifecycle action 都应强制：

```text
stage_query   -> upsertQuery
stage_view    -> upsertView
stage_binding -> upsertBinding
run_check     -> runCheck
compose_patch -> composePatch
```

但注意第 10 点：读 schema 和强制 upsert 需要拆成不同 action。

## 8. Prompt 承担了大量流程控制职责

现有代码：

- `src/ai/authoring/prompt.ts:55-62`
- `src/ai/authoring/prompt.ts:73-82`
- `src/ai/authoring/prompt.ts:86-87`

现状：

prompt 里写了大量流程约束：

```text
不要只 loadSkill 后结束
mock/live 都要 binding
如果 getDraftStatus.can_compose 为 true 就 call composePatch
composePatch 成功后 stop
approval card 等待时 stop using tools
```

不合理点：

这些都是 workflow runtime 的职责。Prompt 是软约束，模型不一定严格遵守；一旦模型没继续，代码层无法保证完整链路。

建议：

Prompt 只保留内容生成职责，例如：

```text
如何写 SQL
如何生成 ViewSpec
如何选择 binding selector
如何解释 runCheck 错误
```

是否继续、强制哪个工具、何时停止，全部由 Runtime 决定。

## 9. 当前 agent 主循环每步重新混合 scope、draftStatus、lifecycle

现有代码：

- `src/ai/authoring/agent.ts:508-571`

现状：

每个 prepareStep 都：

```ts
const decision = computeAuthoringScope(...);
const draftStatus = toolRuntime.getDraftStatusSnapshot();
const lifecycleDecision = deriveAuthoringLifecycleDecision(...);
return { system, activeTools, toolChoice };
```

不合理点：

这说明当前流程控制由三个模块共同拼出来：

```text
scope decision
draft status
lifecycle decision
```

没有单个纯函数拥有完整输入和唯一输出。

建议：

主循环应变成：

```ts
intent = resolveIntent(...)
workflowState = reduceIntent(...)
artifactStatus = inspectArtifacts(...)
action = decideNextAction(...)
runForcedToolStep(action)
```

这样 trace 里每一步可以直接审计：为什么是这个 action、为什么这个 tool 被强制。

## 10. v2 草案里 `stage_query` 同时开放 schema read + 强制 upsert 有矛盾

文档位置：

- `docs/hermes authoring agent v2.md:851-860`

草案写法：

```ts
activeTools = ["upsertQuery", "getSchemaByDatasource"];
toolChoice = "upsertQuery";
```

不合理点：

如果 toolChoice 强制 `upsertQuery`，模型不能先调用 `getSchemaByDatasource`。但生成 SQL 往往需要 schema。开放 `getSchemaByDatasource` 没有意义。

建议：

拆成两个 action：

```text
prepare_query_context -> getSchemaByDatasource
stage_query           -> upsertQuery
```

或者 Runtime 在进入 `stage_query` 前保证 schema 已经读入上下文。

## 11. Layout 在当前代码中是 compose 硬门槛，但 v2 主链路没有显式包含

现有代码：

- `src/ai/authoring/tools/write-tools.ts:370-383`

现状：

```ts
if (unplacedViewIds.length > 0) {
  throw new AuthoringToolGateError({
    code: "missing_layout",
    userSafeSummary:
      `composePatch cannot finalize ... without both desktop and mobile layout.`,
  });
}
```

不合理点：

v2 主链路写的是：

```text
stage_query -> stage_view -> stage_binding -> run_check -> compose_patch
```

但当前系统要求 staged view 必须有 desktop 和 mobile layout。若 v2 不把 layout 纳入流程，要么 `composePatch` 被挡住，要么又要靠 prompt 让 `upsertView` 顺手带 layout。

建议：

二选一：

1. 明确规定 `upsertView` 在 create_view MVP 中必须同时写最小 layout。
2. 新增 `stage_layout -> upsertLayout`，并在 ArtifactStatus 里加入 layout 状态。

## 12. `applyPatch` 语义和 v2 审批边界需要进一步统一

现有代码：

- `src/ai/authoring/tools/write-tools.ts:1154-1168`
- `src/ai/authoring/tools/write-tools.ts:1266-1282`
- `src/ai/authoring/prompt.ts:82`

现状：

`applyPatch` 工具描述是：

```text
Request approval to apply the staged composePatch proposal...
```

同时工具实现里有 `needsApproval`，通过后会：

```ts
input.resetWorkingDraft();
input.recordMutation({ kind: "patch-apply" });
return { applied: true, dashboard: cloneDashboardDocument(candidate) };
```

prompt 又要求：

```text
After composePatch succeeds, stop. ... do not call applyPatch just to create an approval prompt.
```

不合理点：

从命名上看，`applyPatch` 是“应用”，但描述里又像“请求审批”。v2 文档要求：

```text
composePatch -> pending proposal -> wait approval -> applyPatch
```

现有实现需要明确：`applyPatch` 到底是 UI approval gate 后的实际应用，还是 agent 发起 approval request 的工具。否则审批状态会继续分散在工具、prompt、UI message 里。

建议：

把工具语义拆清楚：

```text
composePatch: 生成 proposal，停止
requestApproval/renderApproval: UI 层行为，不由模型调用
applyPatch: 仅在用户审批事件后由 runtime 强制调用
```

## 13. 现有测试正在保护旧架构行为

现有代码：

- `tests/authoring-reliability.test.ts:707-722`
- `tests/authoring-reliability.test.ts:724-739`
- `tests/authoring-reliability.test.ts:1059-1093`

现状：

测试要求：

```text
自然语言不路由
缺少数据上下文时仍开放 write tools
明确创建请求也只是得到同一套 authoring tool surface
```

不合理点：

这些测试和 v2 的核心目标相冲突。v2 要求 intent、goal、dataMode、next action 都由代码层显式推进，不再只是开放工具让模型判断。

建议：

v2 落地时需要先改测试期望，新增回归测试：

```text
探索数据 -> read tools only，不创建 activeGoal，不 mutate draft
创建 live 图 -> 强制 query/view/binding/check/compose
创建 mock 图 -> 不创建 query，但必须 binding
数据不明确 -> ask_user，不开放 write tools
pending approval -> 不开放 write tools
已有旧 query/view -> 不代表当前 goal 完成
```

## 总体建议

v2 的核心方向是对的：

```text
Agent 负责生成内容
Workflow Runtime 负责推进流程
```

但落地时要避免把旧的 `phase + draftStatus.next_required_action` 换个名字搬到 `AuthoringGoal.status` 里。推荐边界：

```text
TurnIntent       = 本轮用户意图
AuthoringGoal    = 跨 turn 的创作目标事实
ArtifactStatus   = 当前目标相关 artifact 事实
WorkflowAction   = 唯一下一步动作
ForcedToolStep   = Runtime 强制执行工具
```

最小迁移路径：

1. 保留现有工具实现：`upsertQuery/upsertView/upsertBinding/runCheck/composePatch/applyPatch`。
2. 新增 v2 纯函数：`resolveIntent`、`createGoalFromIntent`、`inspectArtifactsV2`、`decideNextAction`。
3. 先在 `prepareStep` 接入 `decideNextAction`，替换 `deriveAuthoringLifecycleDecision`。
4. 等 MVP case 通过后，再删除旧 `next_required_action`、旧 `phase` 推导和 prompt 里的流程控制语句。
