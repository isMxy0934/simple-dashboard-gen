# AI-Driven Core Architecture v2

> 注：当前代码实现已经进一步收敛到 `thin route + runtime wrapper + single ToolLoopAgent + native tool approval`。
> 文中关于 `ExecutionPlan`、重 workflow controller 和自定义 approval gate 的段落，更多代表设计演进，不再是最新运行时实现。最新落地以 [runtime-and-api.md](./runtime-and-api.md) 为准。

## 1. 文档定位

本文档定义 Dashboard Authoring 的新核心架构。

它用于替换当前“自定义 chat 壳 + 大工具 + prompt 控流程”的实现方向，收敛到一套以官方 AI SDK 抽象为基础、由代码显式控制主流程、由 AI 负责决策与结构化产出的架构。

本文档重点回答：

- Agent 在新架构中的职责是什么
- Workflow Controller 在新架构中的职责是什么
- `DashboardDocument` 和 `UIMessage[]` 分别是什么真相源
- Tool、structured output、approval、runtime repair 如何协同
- AI SDK UI 如何成为唯一消息协议层
- Skill / MCP 如何作为扩展层接入
- 当前代码如何迁移到新架构

相关文档：

- `README.md`
- `docs/mvp/runtime-and-api.md`
- `docs/mvp/query-spec.md`
- `docs/mvp/ui-layout.md`
- `docs/mvp/tech-stack.md`

## 2. 核心结论

新架构的核心结论只有 10 条：

1. `DashboardDocument` 是业务域的唯一真相源。
2. `UIMessage[]` 是会话与 UI 状态的唯一真相源。
3. 其中最关键、最稳定的业务内容是 `views`、`query_defs`、`bindings`。
4. Agent 必须先生成计划，再进入执行阶段。
5. Agent 是 AI 决策层，不是主流程总控层。
6. Workflow Controller 是主流程控制层。
7. Tool 是系统动作接口，不是所有结构化产物的统一来源。
8. 所有修改 Dashboard 的动作都必须经过 Approval。
9. 自动修复最多允许 2 轮。
10. 聊天协议必须建立在官方 AI SDK UI 之上，不再维护自定义 chat 协议。

一句话定义新系统：

> AI 负责理解、计划和生成结构化产物，Workflow Controller 负责显式状态迁移，系统用 tool schema、approval 和 runtime check 对整个 Dashboard authoring 流程进行约束。

## 3. 现状问题

当前实现存在 6 个结构性问题：

1. Agent 虽然接入了 AI SDK，但核心仍然是“手写 orchestrator + prompt 规则控流程”。
2. 大工具承担了过多职责，例如一次性生成 layout、query、binding 的完整草稿。
3. Prompt 正在替代 tool schema、workflow 和 state machine。
4. 前端虽然使用 `useChat`，但整体交互模型仍接近自定义 chat，而不是 AI SDK UI 驱动的工作流界面。
5. 结构化数据边界不清晰，模型过于接近最终 contract。
6. `DashboardDocument` 与对话/UI 状态没有被明确拆分成两个真相源。

这些问题会直接导致：

- 行为不稳定
- 可解释性差
- 扩展 Skill / MCP 困难
- Approval 和 repair 难以标准化
- UI message / tool trace 难以正规持久化

## 4. 新架构目标

新架构要实现的不是“更会聊天的 Agent”，而是“更可控的 AI 工作流系统”。

### 4.1 目标

- 完全 AI 驱动主流程中的决策与产出
- 先计划，再执行
- `DashboardDocument` 持续保持稳定
- 会话和 UI 状态完全建立在 `UIMessage[]` 之上
- 主流程由代码显式控制
- 所有重要修改先 proposal，再 approval，再 apply
- runtime check 成为正式闭环
- Skill / MCP 作为扩展层正规接入
- 前端消息与 tool 状态完全建立在 AI SDK UI 之上

### 4.2 非目标

当前阶段不追求：

- 多 Agent 编排
- durable execution
- 长期 memory 系统
- 让模型直接生成最终页面结构并自动提交
- 让 MCP 成为核心写路径的唯一实现

## 5. 双真相源

新架构必须明确区分两类真相源。

### 5.1 Business Source of Truth

业务域的唯一真相源是：

- `DashboardDocument`

其中最关键的稳定面是：

- `dashboard_spec.views`
- `query_defs`
- `bindings`

### 5.2 Conversation / UI Source of Truth

会话与 UI 状态的唯一真相源是：

- `UIMessage[]`

它承载：

- 用户消息
- assistant 文本
- tool parts
- approval state
- data parts
- metadata
- UI 恢复所需上下文

### 5.3 两类真相源的边界

- `DashboardDocument` 决定业务内容是什么
- `UIMessage[]` 决定用户当前看到的工作流状态是什么

二者不能混用，也不能互相替代。

## 6. 总体架构

新架构建议拆成 9 层：

```text
User Interface
  -> AI SDK UI Protocol Layer
    -> Workflow Controller Layer
      -> Agent Decision Layer
        -> Structured Output Layer
          -> Tool Layer
            -> Patch / Approval Layer
              -> DashboardDocument Layer
                -> Runtime / Persistence Layer
```

每层职责如下。

### 6.1 User Interface

用户看到的是“工作流 + 聊天”界面，而不是单纯聊天窗口。

它负责：

- 展示对话
- 展示 execution plan
- 展示 tool trace
- 展示 patch proposal
- 承载 approval
- 展示 runtime check 与 repair 状态

### 6.2 AI SDK UI Protocol Layer

这一层必须完全采用官方协议。

必须使用：

- `useChat`
- `UIMessage`
- `message.parts`
- 官方 transport
- 官方 stream protocol

可以接入：

- 官方 resume 机制
- 官方 persistence 接线方式

但必须明确：

- 消息持久化由业务侧实现
- active stream 存储与恢复基础设施由业务侧实现
- resume 不是零配置能力

允许自定义：

- 业务布局
- 样式
- tool result 的业务组件
- approval 面板

不允许继续自定义：

- 自己的 chat message schema
- 自己的流式事件协议
- 自己的 tool 生命周期协议

### 6.3 Workflow Controller Layer

Workflow Controller 是主流程控制层。

它负责：

- 显式控制阶段迁移
- 决定何时进入 planning / drafting / approval / runtime check / repair
- 维护 repair 次数上限
- 处理停止条件
- 控制哪些信息进入模型上下文
- 控制当前阶段可见的 tools

它不负责：

- 自己生成业务内容
- 自己充当大模型

### 6.4 Agent Decision Layer

系统只保留一个主 Agent。

它建议基于官方 `ToolLoopAgent` 实现，但定位为 AI 决策层，而不是总控层。

它负责：

- 理解用户意图
- 生成结构化计划
- 在单个阶段内选择工具
- 解释工具结果
- 读取 runtime feedback 并给出下一步结构化决策

Agent 不能直接写入 `DashboardDocument`。

### 6.5 Structured Output Layer

Agent 不直接产出最终 contract，而是先产出结构化对象。

推荐使用：

- `generateText` / `streamText`
- `output: Output.object(...)`

来生成 schema-validated 的 planning 与 drafting 产物。

### 6.6 Tool Layer

Tool 是系统动作接口。

所有状态读取、草稿生成、patch 组合、运行时校验、审批后应用，全部通过 Tool 完成。

但并非所有结构化对象都必须作为 tool 输出。

### 6.7 Patch / Approval Layer

系统使用确定性代码把结构化 spec 编译成 patch。

所有 patch 都需要：

1. proposal
2. user approval
3. apply

### 6.8 DashboardDocument Layer

最终系统仍然围绕 `DashboardDocument` 工作。

所有业务修改都必须汇聚到这一层。

### 6.9 Runtime / Persistence Layer

runtime check、preview、save、publish 都建立在这一层之上。

同时这一层负责：

- Dashboard 持久化
- `UIMessage[]` 持久化
- active stream 恢复基础设施

## 7. 核心领域对象

### 7.1 业务域对象

业务域对象仍然只有一个核心真相源：

- `DashboardDocument`

其最重要的稳定面是：

- `views`
- `query_defs`
- `bindings`

### 7.2 中间结构化对象

虽然最终真相源只有 `DashboardDocument`，但工作流仍需要少量中间协议对象。

建议保留这几类：

#### `DashboardIntent`

用于表达当前用户意图。

例如：

- 新建销售 Dashboard
- 为当前 view 补 query 和 binding
- 修改已有 view 的图表类型
- 修复 runtime check 失败的绑定

#### `ExecutionPlan`

用于表达 Agent 本轮准备如何执行。

它是结构化 planning 产物，不是必须以 tool 形式存在的动作。

至少应当表达：

- 任务类型
- 影响范围
- 计划步骤
- 依赖哪些工具
- 是否涉及 approval
- 风险摘要

#### `ViewSpec`

用于描述待生成或待修改的 view。

它是 `DashboardView` 的上游结构化草稿，而不是最终存储对象。

#### `QuerySpec`

用于描述待生成的 query。

它是 `QueryDef` 的上游结构化草稿。

#### `BindingSpec`

用于描述待生成的 binding。

它是 `Binding` 的上游结构化草稿。

#### `PatchPlan`

用于描述一次 proposal 将改动哪些 `views`、`query_defs`、`bindings`。

它用于 UI 展示和 approval，不是最终数据库对象。

#### `RuntimeFeedback`

用于表达 runtime check 的结构化反馈。

它是自动修复流程的唯一输入协议。

### 7.3 中间对象设计原则

- 中间对象必须比最终 contract 更轻
- 中间对象必须结构稳定
- 中间对象必须可校验
- 中间对象必须能被确定性代码编译为最终 patch
- 计划对象必须先于执行对象产生

## 8. Workflow Controller 设计

### 8.1 定位

Workflow Controller 是整个系统的主流程控制层。

它不应被 Agent 取代。

### 8.2 职责

它负责：

- 触发 planning
- 触发 drafting
- 触发 `composePatch`
- 触发 approval gate
- 触发 runtime check
- 控制 repair 次数与停止条件
- 决定是否继续调用 Agent

### 8.3 原则

- 主流程状态迁移必须显式
- 高风险边界必须由代码控制
- Agent 只在受控阶段内参与
- 任何时候都不能把审批、停止条件、修复上限完全交给 Agent 自主决定

## 9. Agent 设计

### 9.1 Agent 的职责

Agent 的职责只有 5 项：

1. 理解用户要做什么
2. 生成结构化 `ExecutionPlan`
3. 在单个阶段内选择合适的工具
4. 解释工具结果
5. 基于 `RuntimeFeedback` 生成下一步结构化决策

### 9.2 Agent 的边界

Agent 明确不能做下面这些事：

- 直接写数据库
- 绕过 tool 直接修改 contract
- 绕过 approval 自动提交 Dashboard 修改
- 无限制自动修复
- 自己定义新的消息协议
- 接管整个流程状态机

### 9.3 Agent 的运行原则

- 先计划，再执行
- 优先观察，再生成
- 优先生成 spec，再编译 patch
- 优先 proposal，再 apply
- 优先结构化输出，而不是自由文本
- 失败后必须通过 `RuntimeFeedback` 修复，不允许盲修

## 10. Structured Output 设计

### 10.1 基本原则

Agent 默认输出应该是结构化对象，而不是“约定格式的文本”。

不再允许主要依赖：

- prompt 让模型“返回 JSON”
- 自由文本里夹带半结构化片段
- 大工具一次性吞整个 Dashboard

### 10.2 目标

使用结构化输出能力产出：

- `DashboardIntent`
- `ExecutionPlan`
- `ViewSpec[]`
- `QuerySpec[]`
- `BindingSpec[]`
- `RuntimeFeedback`

`PatchPlan` 由系统编译产生，而不是默认由模型直接生成。

### 10.3 编译边界

必须把“AI 决策”和“系统落地”分开：

- AI 负责产出 planning / drafting objects
- Tool 与代码负责读取、组合、校验和编译
- patch 再进入 approval 和 runtime check

## 11. Tool 设计

### 11.1 Tool 分类

建议把 Tool 分成 5 类。

#### 观察类

- `inspectDashboard`
- `inspectView`
- `inspectDatasource`
- `inspectRuntimeState`

#### 草稿生成类

- `draftViews`
- `draftQueryDefs`
- `draftBindings`

#### 组合类

- `composePatch`

#### 校验类

- `runRuntimeCheck`
- `validatePatchPlan`

#### 提交类

- `applyApprovedPatch`

### 11.2 MVP 最小工具集

MVP 可以先只做下面 8 个工具：

- `inspectDashboard`
- `inspectDatasource`
- `draftViews`
- `draftQueryDefs`
- `draftBindings`
- `composePatch`
- `runRuntimeCheck`
- `applyApprovedPatch`

### 11.3 各工具职责

#### `inspectDashboard`

返回当前 `DashboardDocument` 的结构化摘要。

至少包含：

- dashboard 名称
- view 列表
- query 列表
- binding 列表
- 缺失项
- 推荐下一步

#### `inspectDatasource`

返回 datasource 的结构化摘要。

至少包含：

- datasource id
- dialect
- tables
- fields
- sample semantics

#### `draftViews`

输入用户意图和当前 Dashboard 状态，输出 `ViewSpec[]`。

不直接返回最终 `DashboardView[]`。

#### `draftQueryDefs`

输入当前 views、datasource 摘要和用户意图，输出 `QuerySpec[]`。

#### `draftBindings`

输入当前 views 和 queries，输出 `BindingSpec[]`。

#### `composePatch`

把 `ViewSpec[]`、`QuerySpec[]`、`BindingSpec[]` 编译成 `PatchPlan` 与候选 `DashboardDocument`。

这是系统最关键的确定性边界。

#### `runRuntimeCheck`

对候选 `DashboardDocument` 运行 preview/runtime check，并输出 `RuntimeFeedback`。

#### `applyApprovedPatch`

仅在 approval 通过后执行 patch 应用。

这个工具必须带审批前提，不能让 Agent 自主成功调用。

### 11.4 Tool 设计原则

- 每个 Tool 必须只做一类动作
- Tool 输入必须有 schema
- Tool 输出必须有 schema
- Tool 不应承载过多隐式默认值
- 高风险 Tool 必须支持 approval
- 不把 SDK 的 `experimental_repairToolCall` 和业务 runtime repair 混为一谈

### 11.5 Tool 阶段收缩

当工具数量增多时，应使用 `activeTools` 按阶段收缩当前暴露给模型的工具集。

推荐做法：

- planning 阶段：只暴露 `inspect*`
- drafting 阶段：暴露 `draft*`
- composing 阶段：暴露 `composePatch`
- approval 后阶段：暴露 `runRuntimeCheck` / `applyApprovedPatch`

## 12. Approval 设计

### 12.1 核心规则

所有修改 Dashboard 的动作都必须 approval。

包括但不限于：

- 新增 view
- 修改 view
- 删除 view
- 新增 query
- 修改 query
- 新增 binding
- 修改 binding

### 12.2 工作流

标准流程如下：

1. Workflow Controller 触发 Agent 生成 `ExecutionPlan`
2. Workflow Controller 按 plan 进入 drafting
3. 系统调用 `composePatch`
4. UI 展示 `PatchPlan`
5. 用户点击批准或拒绝
6. 仅批准后，系统才允许 `applyApprovedPatch`

### 12.3 UI 要求

Proposal 展示必须可读。

至少应当显示：

- 改动对象类别
- 改动路径
- 改动摘要
- 风险提示
- 批准 / 拒绝操作

## 13. Runtime Check 与自动修复

### 13.1 Runtime Check 的地位

`runRuntimeCheck` 不是辅助功能，而是主流程的一部分。

### 13.2 自动修复规则

自动修复最多允许 2 轮。

只有在以下场景允许自动修复：

- query 与字段映射不匹配
- binding 字段缺失
- 数据为空但结构可恢复
- view 与 query schema 未对齐

不允许自动修复的场景：

- 用户明确要求的业务语义变化
- 需要新增或删除关键业务 view
- 需要替换用户已明确批准的业务指标定义

### 13.3 修复流程

1. `runRuntimeCheck` 返回 `RuntimeFeedback`
2. Workflow Controller 判断是否允许 repair
3. Agent 基于反馈重新生成或更新 `ExecutionPlan`
4. Agent 进入新的 drafting 阶段
5. 系统重新 `composePatch`
6. 系统重新执行 runtime check
7. 超过 2 轮直接停止

### 13.4 停止条件

满足下面任一条件必须停止自动修复：

- runtime check 成功
- 达到 2 轮上限
- 错误属于非自动修复范围
- 新 patch 会改变用户已确认的业务意图

## 14. UI 与消息协议

### 14.1 总体形态

新 UI 不是纯聊天，而是“工作流 + 聊天”。

### 14.2 固定区域

Authoring 页面中的 Agent 区建议固定拆成 6 个区域：

#### Conversation

展示用户消息和 Agent 的简洁说明。

#### Execution Plan

展示本轮计划：

- 目标
- 影响范围
- 预计步骤
- 当前阶段

#### Tool Trace

展示每次工具调用：

- 工具名
- 输入摘要
- 输出摘要
- 成功 / 失败
- 是否需要 approval

#### Proposed Patch

展示本轮 proposal 将修改的：

- views
- query_defs
- bindings

#### Approval Actions

展示批准与拒绝按钮。

#### Runtime / Repair Status

展示：

- runtime check 状态
- 错误摘要
- 当前自动修复轮次

### 14.3 AI SDK UI 约束

必须直接使用官方 AI SDK UI 能力：

- `useChat`
- `UIMessage`
- `message.parts`
- tool parts
- 官方 stream protocol

可以自定义的是业务壳层，而不是消息协议本身。

### 14.4 Persistence 与 Resume

应采用 AI SDK UI 的官方消息格式、stream protocol 和 resume 机制。

但必须明确：

- `UIMessage[]` 的持久化由业务侧实现
- active stream 与 chat 关系存储由业务侧实现
- stream resume 需要额外基础设施，不是零配置能力

### 14.5 服务端校验

服务端在把消息送入模型之前，应先：

1. `validateUIMessages`
2. 再 `convertToModelMessages`

### 14.6 模型上下文裁剪

不要把所有 UI data parts 都送回模型。

推荐默认不进入模型上下文的内容：

- tool trace 细节
- patch diff 全量
- 审批面板 UI 状态
- runtime 调试日志

只把必要摘要转换为 model messages。

## 15. Skill 与 MCP 扩展

### 15.1 扩展目标

新架构必须预留 Skill 和 MCP 的接入能力。

### 15.2 MCP 定位

MCP 作为正式运行时扩展协议存在，但不应成为生产核心写路径的唯一实现。

核心写路径优先本地 AI SDK tools。

MCP 更适合承载：

- 外部 datasource schema 能力
- 数据平台能力
- 文件/知识库检索
- 企业内部系统能力

### 15.3 MCP Tools 与 MCP Resources

必须区分两类 MCP 能力：

- MCP Tools：模型可调用动作
- MCP Resources：应用主动读取并注入模型上下文的数据源

不要把资源读取与动作执行混成一层。

### 15.4 Skill 定位

Skill 不作为运行时核心协议，而作为能力打包层存在。

建议把 Skill 定义为 capability bundle：

- 一组 tools
- 一组 instructions / prompts
- 可选 resources
- 可选 UI 呈现
- 可选 approval policy

### 15.5 扩展分层

建议采用下面的扩展结构：

```text
Tool Provider Layer
  - Local Tools
  - MCP Tools

Resource Provider Layer
  - Local Resources
  - MCP Resources

Skill Registry Layer
  - dashboard-authoring
  - sql-repair
  - chart-design
  - datasource-onboarding
```

### 15.6 扩展原则

- 本地工具与 MCP 工具统一映射为 Tool
- MCP resources 由应用侧决定何时读取与注入
- Skill 负责组装能力，不直接修改核心 contract
- 任何来自 Skill / MCP 的 Dashboard 修改都必须经过 approval

## 16. API 设计影响

### 16.1 Agent Chat API

`POST /api/agent/chat` 在新架构中继续存在，但职责会收窄为：

- 接收 `UIMessage[]`
- 恢复 Agent 会话
- 驱动单阶段 Agent 决策与工具调用
- 返回 UI message stream

它不直接承担：

- 保存 Dashboard
- 发布 Dashboard
- 绕过 approval 的 patch 应用
- 接管整个业务流程状态机

### 16.2 Save / Publish API

`Save / Publish` 仍保持独立。

Agent 负责生成与修复 draft，不负责持久化业务动作。

## 17. 目录建议

建议后续逐步演进到下面的目录结构：

```text
/app
  /api/agent
  /api/preview
  /api/dashboard

/components
  /authoring
    /agent-ui
    /workflow-panels

/lib
  /ai
    /agent
    /workflow
    /tools
    /skills
    /mcp
  /contracts
  /dashboard
    /specs
    /patches
    /approval
    /runtime
    /persistence
```

## 18. 迁移路径

建议分 6 个阶段迁移。

### Phase 1: 双真相源与协议收敛

- 统一 `UIMessage` 协议
- 清理自定义 chat 语义
- 固化 AI SDK UI transport / stream protocol
- 明确 `DashboardDocument` 与 `UIMessage[]` 的双真相源边界

### Phase 2: Workflow Controller

- 引入显式 workflow controller
- 从 Agent 中拿掉主流程状态迁移职责
- 固化 planning / drafting / approval / repair 阶段

### Phase 3: Structured Output + Tools

- 用 structured output 生成 `ExecutionPlan`
- 拆掉大工具
- 引入 `draftViews` / `draftQueryDefs` / `draftBindings`
- 引入 `composePatch`
- 按阶段使用 `activeTools`

### Phase 4: Approval 工作流

- 建立 proposal UI
- 建立 approval gate
- 高风险 patch 一律先审后用
- 服务端显式校验 approval responses

### Phase 5: Runtime Repair

- 把 `RuntimeFeedback` 结构化
- 建立最多 2 轮修复闭环
- 区分 SDK tool-call repair 与业务 runtime repair

### Phase 6: Skill / MCP

- 引入 Tool Provider Layer
- 引入 Resource Provider Layer
- 接入 MCP tools / resources
- 建立 Skill Registry

## 19. 验收标准

当下面这些条件都成立时，可以认为新核心架构落地成功：

1. `DashboardDocument` 和 `UIMessage[]` 的职责清晰分离。
2. Workflow Controller 显式控制主流程状态迁移。
3. Agent 只负责 AI 决策与结构化产出，不再担任总控。
4. `ExecutionPlan` 通过 structured output 生成。
5. 前端消息协议完全建立在 AI SDK UI 之上。
6. 服务端先 `validateUIMessages`，再送入模型。
7. 当前阶段的工具通过 `activeTools` 收缩。
8. 所有修改 Dashboard 的动作都必须经过 approval。
9. `views`、`query_defs`、`bindings` 的改动都可以通过统一 `PatchPlan` 展示。
10. runtime check 失败后可以自动修复，但不超过 2 轮。
11. Tool trace 对用户可见。
12. Skill / MCP 可以作为扩展层接入，而不破坏主流程。

## 20. 最终定义

新系统不是一个“会聊天的 Dashboard 生成器”。

它是一个：

- 以 `DashboardDocument` 为业务真相源
- 以 `UIMessage[]` 为会话/UI 真相源
- 以 `views / query_defs / bindings` 为稳定核心
- 以 Workflow Controller 为主流程控制层
- 以官方 Agent 为 AI 决策层
- 以 `ExecutionPlan` 为执行入口
- 以 Tool 为系统动作边界
- 以 structured outputs 为 AI 与系统的边界
- 以 approval 和 runtime repair 为安全机制
- 以 AI SDK UI 为唯一消息协议层
- 以 Skill / MCP 为扩展能力层

的 AI-Driven Dashboard Authoring System。
