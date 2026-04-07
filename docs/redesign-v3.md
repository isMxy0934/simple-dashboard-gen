# 产品改造设计文档 v3

> 这份文档用于**团队对齐方向**与**后续任务拆分**。它说明我们这轮为什么改、重点改什么、按什么顺序推进；**不展开过细实现细节**。

---

## 1. 文档定位

### 1.1 这份文档要解决什么问题

当前代码已经具备一个可工作的 dashboard authoring 雏形，但整体体验仍然夹在「AI 原型」与「正式产品」之间：

- AI 能改 dashboard，但**连续创作能力不稳定**
- 创作页能用，但**仍暴露大量开发者视角内容**
- 一些关键交互能跑通，但**产品摩擦和稳定性问题仍然明显**

因此，这份文档的目标不是把所有未来想法一次写完，而是先把**本轮最重要的改造方向**讲清楚，方便团队后续按阶段落地。

### 1.2 这份文档承担的角色

这份文档同时承担两个角色：

1. **方向文档**：帮助团队理解这一轮 redesign 想解决什么问题
2. **拆分骨架**：为后续任务拆分提供结构，而不是直接充当实现细节说明书

### 1.3 这份文档不承担什么

这份文档**不**承担以下职责：

- 不写成逐字段、逐接口、逐表结构的实现文档
- 不提前锁死所有技术细节
- 不穷尽所有未来平台化方向
- 不把当前阶段与后续阶段混写成一个大而全方案

---

## 2. 本轮改造目标

本轮 redesign 只聚焦两个一级目标，并保留一组配套支撑项。

### 目标一：让 AI 成为可靠的主创作通道

我们希望用户把需求交给 AI 后，系统更像是在**持续编辑一个 dashboard**，而不是每一轮都重新猜上下文。

这一目标关注的是：

- AI 更容易知道当前在改哪个 view
- AI 的操作链路更直接，不依赖脆弱的路由猜测
- AI 可以分阶段完成一次创作，而不是要求一轮内做完所有事情
- 删除、修改、审批等核心动作具备完整能力

一句话概括：

> **让 AI 从“偶尔能改对”变成“能稳定接住连续创作”。**

### 目标二：让创作页变成产品，而不是开发工具

我们希望创作页对普通用户来说更可理解、更可使用，而不是继续暴露过多内部概念、调试信息和工程化操作方式。

这一目标关注的是：

- AI 面板和当前焦点更清晰
- 状态文案从系统语言改成用户语言
- 开发期残留内容从界面中移除
- 面板与 Drawer 从“调试工具”升级为“产品交互”
- 常见交互行为更稳定、可控、一致

一句话概括：

> **让创作体验看起来像产品，而不是工程调试台。**

### 配套支撑：补齐稳定性与工程质量

这一部分不是主文档的 headline，但它是前两个目标落地的必要支撑。

主要包括：

- 拖拽与布局交互流畅度
- 图表初始化与重绘稳定性
- Viewer 错误兜底与加载反馈
- 预览链路与工程维护成本

一句话概括：

> **把当前会卡、会脆、会混乱的基础问题补平。**

---

## 3. 暂不纳入本轮范围

### 3.1 数据源能力改造暂不进入主文档

数据源管理与配置化是合理方向，但不属于本轮 redesign 的核心叙事。

原因不是它不重要，而是它和本轮的主要目标不在同一层：

- 本轮更关注 **AI 创作链路** 与 **创作产品体验**
- 数据源能力更接近 **平台化建设**，适合单独规划

因此：

- 主文档不展开数据源管理方案
- 数据源相关内容拆到单独文档维护
- 后续需要推进时，再以独立议题启动

相关文档：`docs/datasource-redesign.md`

### 3.2 本轮不追求“大而全重构”

本轮不以一次性重构整个系统为目标，而是优先完成：

- 主链路正确
- 主要产品体验可用
- 关键稳定性问题得到控制

---

## 4. 基于当前代码的现状判断

以下判断基于当前代码库现状，而不是抽象设想。

### 4.1 AI 创作链路的问题已经很明确

当前系统的主要问题不是“AI 完全不能工作”，而是**链路不够稳定、不够连续**。

当前已确认的问题包括：

- Agent 仍使用正则做部分 route 决策，容易在自然语言场景中误判
- `selectedViewId` 存在于前端状态，但没有进入 AI 上下文
- tool 集合具备 upsert 能力，但删除能力不完整
- working draft 主要依赖请求期内内存，跨回合连续创作能力不足
- apply patch 后前端焦点无法稳定回到 AI 实际操作目标

### 4.2 创作页仍保留明显的开发工具痕迹

当前创作页并非不可用，但产品表达不成熟。

已确认的问题包括：

- **AI 面板默认折叠**：用户打开创作页看到的是空画布，AI 是角落里的浮动按钮。如果 AI 是主创作通道，这个默认状态本身就在传递错误信号。这是产品身份层面的问题，不只是 UI 细节。
- **审批卡片用系统路径描述操作**：用户看到的是 `dashboard_spec.views.v_ai_1`，而不是"AI 要帮你添加一个柱状图"。
- **画布卡片状态标签是工程语言**：`SQL + Binding`、`Mock`、`Unbound` 对非技术用户没有意义。
- JSON 编辑器式 Drawer 暴露了过多底层结构
- 用户界面中仍有开发注释与调试性文字
- 状态标签仍带有系统内部命名痕迹
- 局部页面与 loading 文案仍存在中英文混用
- 一些交互仍依赖 `window.confirm`、`window.open` 等低产品化方式

### 4.3 一些基础交互还不够稳

这类问题不一定决定方向，但会直接影响用户感受：

- 拖拽时整页更新带来卡顿风险
- 图表初始化与容器尺寸稳定性耦合较强
- Viewer 的错误兜底和加载态还不够产品化

这些问题不必单独抬升为一级目标，但必须进入本轮支撑项。

---

## 5. 关键设计原则

### 5.1 AI 是主创作通道，人工是快捷子集

AI 负责结构性编辑，人工操作主要承担低风险、即时性的快捷调整。

```text
AI 主通道
- create / update / delete view
- create / update / delete query
- create / update / delete binding
- change layout / title / description

人工快捷通道
- drag / resize
- inline edit title / description
- low-risk visual adjustments
```

这个原则的含义不是“人工不能改”，而是：

> **人工操作不应反向要求用户理解完整 contract；复杂结构仍由 AI 主导。**

### 5.2 高风险操作与低风险操作必须分层

本轮要明确区分两类动作：

- **低风险**：布局、标题、描述、轻量视觉调整
- **高风险**：query、binding、删除、真实数据接入

这会直接影响审批、交互摩擦和默认流程设计。

### 5.3 先保证连续创作，再补体验细节

本轮优先级顺序应该是：

1. AI 主链路可靠
2. 创作体验产品化
3. 性能与稳定性补齐

换句话说，不能只做 UI 漂亮化，而放着主创作链路不稳。

### 5.4 优先做减法，而不是继续堆概念

本轮改造更应该：

- 删除错误抽象
- 收紧范围
- 清理暴露给用户的内部实现细节
- 用更少的概念表达更清晰的产品行为

---

## 6. 主要改造面

### 6.1 Agent 改造：让 AI 创作链路更可靠

这一部分是本轮最核心的改造面。

#### 方向 A：简化 route 与主循环

目标不是增加更多路由分类，而是让主链路更简单、更稳定。

建议方向：

- 保留 approval 作为强约束关口
- 弱化或移除脆弱的自然语言正则路由判断
- 让更多普通请求直接进入统一 agent loop

核心目标：

> **减少“系统先猜错路线，再开始工作”的概率。**

#### 方向 B：补上 focused view 上下文

用户点中某张图后再发起请求，AI 应该天然知道“当前大概率在讨论谁”。

这类上下文不应该继续靠 agent 自己额外探查。

核心目标：

> **把“当前焦点”从前端状态变成 AI 可直接消费的上下文。**

#### 方向 C：支持分阶段创作

当前创作过程更像“一口气完成”，而我们希望它变成“分阶段推进”。

典型场景应该是：

1. 先创建 view 和外观
2. 再确认是否接真实数据
3. 最后补 query / binding

核心目标：

> **让 AI 能像设计师一样逐步搭建，而不是一次拼完整份 contract。**

#### 方向 D：补齐删除与审批能力

如果 AI 是主创作通道，就不能只有创建/修改能力，而缺少完整删除能力。

同时，删除和数据接入这类高风险动作，需要进入更清晰的审批层级。

核心目标：

> **让 AI 能完整编辑 dashboard，同时让风险边界更明确。**

---

### 6.2 产品化改造：让创作页更像真正的产品

#### 方向 A：让 AI 面板从“隐藏能力”变成“显式能力”

**核心改动：AI 面板应该默认展开、固定在右侧，而不是浮动 dock。**

当前 AI 面板是可拖拽的浮动组件，默认折叠（`isDockOpen` 初始为 `false`）。这让 AI 看起来像附加功能，而不是主创作通道。需要调整为：画布和 AI 面板并列是创作页布局的基本假设，AI 不是用户手动唤出的可选项。

AI 面板应该明确表达：

- 当前画布焦点是哪个 view
- AI 正在帮用户处理什么
- 哪些内容等待确认

布局示意：

```text
创作页
+---------------------------------------------------+
| 顶栏：名称 / 状态 / 保存 / 发布                    |
+------------------------------+--------------------+
| 画布                         | AI 助手（默认展开） |
| - 选中 view 高亮             | - 当前焦点         |
| - 卡片快捷操作               | - 对话流           |
| - 空状态引导                 | - 审批卡片         |
+------------------------------+--------------------+
```

审批卡片语言也要随之改变，用户看到的是人能读懂的操作描述，而不是系统路径：

```text
现在：
  add  dashboard_spec.views.v_ai_1
  add  query_defs.q_ai_1

应该是：
  AI 为你创建了「周销售趋势」柱状图，连接了销售数据库
  [应用]   [取消]
```

`patch.operations` 里已有 `summary` 字段，直接用它渲染即可，不需要展示 `path`。

#### 方向 B：把界面语言改成用户语言

本轮应尽量把以下内容统一成产品表达：

- 状态标签：画布卡片上的 `SQL + Binding` → `已连接数据`，`Mock` → `演示数据`，`Unbound` → `待配置`
- loading / empty / error 文案
- viewer 与 authoring 间的语言风格
- 调试性或解释性内部文案
- Drawer 内所有 hardcode 英文字符串（`Manual Fallback`、`Template Layer`、`Query Contract` 等）全部过 i18n

核心目标：

> **界面应该描述"用户能理解的状态"，而不是"系统内部实现状态"。**

#### 方向 C：把 Drawer 从开发者工具改成用户配置面板

当前 Drawer 更像底层结构编辑器，而不是产品中的“配置区”。

未来它更适合承担：

- 外观相关配置
- 当前数据状态说明
- 与 AI 协作的入口
- 少量必要但可理解的可视化配置

而不应该继续承担：

- 原始 JSON 大量直接暴露
- query contract 的底层编辑主入口

#### 方向 D：清理明显的产品摩擦点

包括但不限于：

- 删除确认方式
- 预览打开方式
- patch 应用后的焦点归位
- Viewer 的信息表达一致性

这些问题单看都不大，但会持续破坏产品完成度。

---

### 6.3 配套支撑：稳定性与质量补齐

#### 方向 A：拖拽与布局性能

拖拽时应优先保证交互流畅，而不是每次 pointer move 都触发重计算和整页更新。

#### 方向 B：图表渲染稳定性

ECharts 初始化、容器尺寸稳定、重绘时机等问题，需要作为支撑工作系统性处理。

#### 方向 C：Viewer 兜底能力

Viewer 需要更完整的：

- 加载反馈
- 错误提示
- 空结果说明

#### 方向 D：工程维护性

对于预览链路、迁移方案、状态持久化等问题，本轮应优先满足“可维护、可继续迭代”，不追求一次到位。

---

## 7. 分阶段任务拆分

为了让主文档既能对齐方向，也能支撑任务拆分，本轮建议按三个阶段推进。

### Phase 1：先把 AI 主链路拉直

优先处理最直接影响 AI 连续创作的问题：

- route 简化
- focused view 上下文注入
- 删除能力补齐
- patch 应用后的焦点归位
- 用户可见的明显开发残留清理

阶段目标：

> **先让 AI 改得更准、链路更顺。**

### Phase 2：把创作体验从“能用”推到“像产品”

在主链路更稳定后，再集中做产品化表达：

- AI 面板与焦点表达
- 状态标签与界面文案统一
- Drawer 产品化改造
- 交互方式替换与统一
- 审批表达更清晰

阶段目标：

> **让用户感知到这不是 demo，而是可用产品。**

### Phase 3：补齐连续创作与稳定性支撑

最后收敛较重但必要的支撑改造：

- working draft 跨请求持久化
- 拖拽性能优化
- 图表初始化稳定性
- Viewer 错误边界与加载态
- 预览链路与工程质量补齐

阶段目标：

> **让核心体验不只是能演示，而是能稳定运行。**

---

## 8. 任务拆分建议

如果后续要拆成任务，可以按下面三组去拆，而不是按零散点状需求拆。

### 8.1 AI 主链路组

负责：

- agent route
- focused context
- tool 能力完整性
- 审批与 patch 行为一致性
- 连续创作能力

### 8.2 产品体验组

负责：

- authoring 主界面信息架构
- AI 面板可见性与审批表达
- Drawer 重设计
- 用户语言统一与 i18n 清理
- 交互摩擦点治理

### 8.3 稳定性支撑组

负责：

- 拖拽性能
- 图表初始化稳定性
- Viewer 兜底能力
- 预览链路与工程质量问题

---

## 9. 成功标准

如果这份 redesign 文档是成功的，团队成员读完后应该能回答：

1. 这轮 redesign 为什么要做
2. 这轮最重要的两个目标是什么
3. 为什么数据源不在主文档里
4. 主要改造面分别是什么
5. 应该按什么阶段拆任务，而不是把所有点平铺并列

---

## 10. 关键设计决策

本节补充主文档中"方向已定但实现路径未说清"的五个关键决策点，供实现阶段直接参考。

### 10.1 Focused View 的传递路径

**问题**：用户在画布上选中了某张图，再向 AI 发请求，AI 完全不知道用户在看哪里。

**设计**：最小改动路径，沿已有的请求数据流透传一个字段。

```
前端 selectedViewId（useState in authoring-app.tsx）
  ↓ handleGenerateAi() 时读取
  ↓ 加入请求体 DashboardAgentChatRequestBody.focusedViewId
  ↓ chat-request.ts 解析出 focusedViewId
  ↓ chat-service.ts 传给 createDashboardAgentWorkflow
  ↓ workflow.ts 注入 system prompt 上下文：
      "The user currently has view '{title}' ({id}) focused on the canvas."
  ↓ buildDashboardAgentEngineControl 把它加入 summary
```

需要改动的文件：

- `agent-contract.ts`：`DashboardAgentChatRequestBody` 加 `focusedViewId?: string | null`
- `chat-request.ts`：`ResolvedAgentChatRequest` 及解析逻辑
- `chat-service.ts`：透传到 `createDashboardAgentWorkflow`
- `workflow.ts`：接口 + system prompt 注入
- `use-agent-session.ts`：接收 `selectedViewId` 并在发请求时带上

不引入新抽象，全在已有数据流路径上改。

### 10.2 Working Draft 跨回合持久化

**问题**：`WorkingDraftState` 存在于每次 `buildDashboardAgentTools` 调用的内存中，请求结束即丢失。连续两轮创作无法在同一个 draft 上叠加。

**设计**：利用已有的 `DashboardAgentSessionPayload` 持久化机制，把 draft 挂到 session 的 `prompt` 字段下。

扩展 `DashboardAgentSessionState`：

```ts
prompt: {
  lastContextFingerprint: string | null;
  workingDraft?: {
    dashboardSpec?: DashboardDocument["dashboard_spec"];
    queryDefs?: QueryDef[];
    bindings?: Binding[];
    bindingMode?: "mock" | "live";
    dirtyViewIds: string[];    // Set → string[]，可序列化
    dirtyQueryIds: string[];
    dirtyBindingIds: string[];
    layoutTouched: boolean;
    stagedAt: string;          // 便于调试和过期判断
  } | null;
};
```

关键行为约定：

- `initializeDashboardAgentChatSession` 从 session 读出 `workingDraft`，作为初始状态传给 `buildDashboardAgentTools`
- `buildDashboardAgentTools` 改接口，接受 `initialDraft?` 参数，同时暴露 `getDraftSnapshot()` 供外部读取当前 draft 状态
- `applyPatch` 执行成功后：stream completion handler 调用 `persistDashboardAgentChatSessionSnapshot` 时将 `workingDraft: null` 写回，清空 draft
- `persistDashboardAgentChatSessionSnapshot` 调 `getDraftSnapshot()` 把最新 draft 存入 session

不需要新的基础设施。session-repository 已经在工作，只是 schema 扩展。

### 10.3 deleteView 工具的语义设计

**问题**：AI 没有显式删除工具。要删除一个 view，AI 只能"不 upsert 它"然后期望 composePatch 推断出 remove 操作，语义不清晰且容易出错。

**设计**：加显式 `deleteView` 工具（`deleteQuery`、`deleteBinding` 同理），放入 write mode 工具集。

```ts
deleteView: tool({
  description: "Remove a view and its layout entries from the draft dashboard spec.",
  inputSchema: z.object({
    view_id: z.string().min(1),
    reason: z.string().optional(),
  }),
  execute: async ({ view_id }) => {
    // 1. 从 workingDraft.dashboardSpec.views 移除该 view
    // 2. 从 layout.desktop/mobile.items 移除对应 item
    // 3. workingDraft.dirtyViewIds.add(view_id)  ← 关键：标记 dirty
    // 4. 孤立的 query/binding 由 reconcileDashboardDocumentContract 自动清理
    return { summary: `Staged removal of view "${view_id}".` };
  }
})
```

`buildPatchFromDocument` 中已有处理"在 dirtyIds 里但 next 里不存在"的逻辑，会正确生成 `{ op: "remove", ... }`，**不需要改 patch 生成逻辑**。

风险分层天然成立：`deleteView` 调用后仍需 `composePatch` → `applyPatch`（`needsApproval: true`），用户必须明确确认才能生效。

### 10.4 分阶段创作的 patch 模型

**结论**：不需要改 patch 模型本身。`kind: "layout" | "data"` 的分类已经足够表达两个阶段。

真正缺的是两件事：

**（a）系统提示没有告知 AI 可以分阶段**

需要在 system prompt 中加明确指导：

```
You can author in stages:
1. First create the view structure and appearance
   (upsertView → composePatch → applyPatch)
2. Later, in a follow-up turn, add real data connections
   (upsertQuery → upsertBinding → composePatch → applyPatch)
You do not need to complete both stages in one turn.
```

**（b）跨回合 draft 不持久**

由 10.2 的方案解决后自然消除。

分阶段流程在代码层面的实际路径：

```
Round 1：upsertView → composePatch(kind=layout) → applyPatch → draft 清空
Round 2：AI 看到已有 view（通过 focusedViewId 上下文）→
         upsertQuery → upsertBinding → composePatch(kind=data) → applyPatch
```

两轮之间不需要用户做任何特殊操作，只需自然地继续对话。

### 10.5 Drawer 产品化的替代形态

**原则**：不删掉已有开发调试能力，而是重新分层，把产品信息前置、开发细节后收。

**新 Drawer 结构（三段式）**：

```
┌─────────────────────────────────┐
│ 第一段：视图摘要（始终可见）        │
│  - 标题（可编辑）                 │
│  - 描述（可编辑）                 │
│  - 数据状态（用户语言）            │
│    · "使用演示数据"      ← Mock   │
│    · "已连接数据 · {查询名}"← Bound│
│    · "数据错误 · {简述}" ← Error  │
│    · "暂未绑定数据"    ← No Bind  │
├─────────────────────────────────┤
│ 第二段：AI 快捷操作（新增）        │
│  [修改图表外观]  [更换数据来源]    │
│  点击后预填 chat input，聚焦 AI  │
├─────────────────────────────────┤
│ 第三段：开发者工具（默认折叠）      │
│  ▸ 高级（点击展开）              │
│  · renderer.option_template JSON │
│  · Query SQL、Params、Output     │
│  · Binding 参数映射              │
└─────────────────────────────────┘
```

第三段就是现有 `advancedMode` 的内容原样搬入，**触发方式**从画布上的"Edit"按钮改成 Drawer 内底部的低调"高级"折叠链接。

同时，Drawer 内所有 hardcode 英文字符串（"Manual Fallback"、"Template Layer"、"Query Contract"、"Binding Contract"、"Param Mapping" 等）全部走 `t()` 接入 i18n。

### 10.6 AI 工作流阶段对用户的可见性

**背景**：当前 AI 面板的 Studio tab 中暴露了工作流阶段（`Inspect State → Stage Changes → Request Approval`）和 agent 内部状态，这是 AI pipeline 的技术细节，不是用户需要理解的内容。

**决策：降权保留，默认不显示。**

- 普通创作流程中，用户只看到"AI 正在工作…"的简单进度状态
- 工作流细节（阶段、工具调用、路由决策）收入可展开的「详情」区域，默认折叠
- 面向技术用户的可观测性不删除，但不作为默认 UI 的一部分呈现

这个原则同时适用于其他"技术细节是否对用户可见"的判断：**默认隐藏，按需可查**。

---

## 11. 后续独立议题

以下内容保留为后续独立议题，不纳入本轮主文档主线：

- 数据源管理与配置化：`docs/datasource-redesign.md`
- 更长期的平台化建设
- 更细粒度的实现方案文档

---

## 12. 一句话总结

这轮 redesign 的核心，不是把系统一次性做大做全，而是先完成两件事：

- **让 AI 真正成为可靠的主创作通道**
- **让创作页真正像一个产品**

其余能力，尤其是数据源平台化，后续单独推进。
