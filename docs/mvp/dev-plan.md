# MVP Dev Plan v0.2

## 1. 文档定位

本文档把当前 MVP 文档集转换为研发顺序和阶段目标。

它重点回答：

- 先做什么
- 后做什么
- 每个阶段交付什么
- 做到什么算完成

相关文档：

- `README.md`
- `docs/mvp/dashboard-spec.md`
- `docs/mvp/query-spec.md`
- `docs/mvp/runtime-and-api.md`
- `docs/mvp/tech-stack.md`
- `docs/mvp/authoring-viewer-flow.md`
- `docs/mvp/ui-layout.md`

## 2. 规划原则

核心原则：

1. 先冻结协议，再做实现
2. 先跑通 Viewer 运行时，再做 Authoring
3. 先把 Agent 承接链路做稳，再扩 Save / Publish
4. 人工编辑只保留必要的审核和兜底能力
5. 先保证可运行，再保证自动化和复杂流程

## 3. 总体阶段

建议将 MVP 研发拆成 6 个阶段：

1. Phase 0: Contracts Freeze
2. Phase 1: Viewer Runtime First
3. Phase 2: Authoring Layout First
4. Phase 3: Query And Binding
5. Phase 4: Agent-Driven Flow
6. Phase 5: Save And Publish

## 4. Phase 0: Contracts Freeze

### 4.1 目标

冻结当前 MVP 的协议、流程和页面结构。

### 4.2 产出

- `DashboardSpec` 定稿
- `view.renderer + slots` 最小结构定稿
- `QuerySpec + Binding` 定稿
- `DatasourceContext` 最小结构定稿
- `Runtime And API` 定稿
- `Tech Stack` 定稿
- `Authoring / Viewer Flow` 定稿
- `UI Layout` 定稿

### 4.3 完成标准

- 团队对核心对象没有歧义
- 前后端知道各自输入输出
- 页面结构和最小交互已经明确
- `DatasourceContext` 的来源边界已统一
- `binding_results[].data.rows` 返回格式已统一

## 5. Phase 1: Viewer Runtime First

### 5.1 目标

先跑通“读取定义 -> 查数据 -> 渲染”的只读链路。

### 5.2 产出

- `Next.js Route Handlers`
- Dashboard 定义输入层
- Query 批量执行接口
- 前端 Viewer 页面
- 前端 batch 请求级缓存
- 基础 renderer
- `binding_results[].data.value -> renderer.slots[].path` 注入链路

### 5.3 完成标准

- fixture / stub Dashboard 能渲染出 Viewer 页面
- 相同 batch 请求不会重复发送
- 后端对相同 query 执行完成去重
- 页面能区分成功、空数据和错误
- Phase 1 不依赖持久化读取

## 6. Phase 2: Authoring Layout First

### 6.1 目标

把 Authoring 的布局编辑和本地 draft 能力做出来。

### 6.2 产出

- Authoring 页面框架
- 顶部工具栏
- Agent 面板壳子
- 中间画布区
- view 级按需编辑抽屉
- 拖拽布局能力
- 本地状态管理
- view 模板编辑入口

### 6.3 完成标准

- 用户可以生成或调整一个 Dashboard 结构
- 用户可以拖拽和调整 view 布局
- 用户可以切换 Desktop / Mobile
- `mobile` 布局可以由 `desktop` 自动生成
- 本地 draft 可以保留和恢复

## 7. Phase 3: Query And Binding

### 7.1 目标

把 Authoring 与 preview 查询链路打通，并把页面交互调整到“Agent 驱动、人审核”。

### 7.2 产出

- preview 接口接入
- query / binding 本地承接能力
- view 状态标签
- 错误态展示
- Review Mode / Adjust Layout Mode
- Advanced 高级兜底入口
- Agent 面板对话式主流程

### 7.3 建议任务

#### 前端

- 移除人工 `Layout / Data` 阶段切换
- Agent 面板改成对话优先结构
- 根据 Dashboard 状态生成首条引导消息
- Canvas 默认进入 Review Mode
- 增加 `Adjust Layout` 模式开关
- 移除固定右侧属性面板
- 把人工介入收敛到 view 级编辑抽屉
- `Advanced` 中保留 query / binding 兜底能力

#### 后端

- 完善 preview 接口
- 增加 query 结果 schema 校验
- 增加结构化错误返回
- 继续保证 `binding_results[].data.rows` 稳定返回

### 7.4 完成标准

- 一个 Dashboard 可以从 layout 走到 query binding
- Preview 可以返回可消费的数据结果
- 页面能区分 `Draft / No Binding / Bound / Preview OK / Error`
- Authoring 主路径变成 Agent 驱动
- 人工编辑只剩布局微调和高级兜底

### 7.5 非目标

- 不做复杂筛选联动
- 不做版本管理 UI
- 不做真实多 Agent 编排

## 8. Phase 4: Agent-Driven Flow

### 8.1 目标

把 Agent 从“建议生成器”推进成真正的主流程驱动层。

### 8.2 原则与进入条件

- Agent 不绕开协议和 runtime
- `DatasourceContext` 必须稳定可用
- Agent 输出必须进入统一校验和 preview 链路
- Agent 使用单一 prompt 定义能力边界，不为不同用户入口维护多套 prompt 架构
- Agent 的有效输出必须是可解析为 `DashboardDocument` patch 的结构化 JSON，而不是自由文本
- tools 定义 Agent 能执行的动作；contract 当前状态决定下一步，而不是用户入口类型
- preview / runtime check 的结构化反馈必须能重新回流给 Agent，用于有限轮次自修复

### 8.3 产出

- 真实 LLM 驱动的单 Agent
- `/api/agent/chat` 流式会话接口
- 单一 agent prompt
- tool set 和 tool schema
- `DashboardDocument` patch 协议
- preview / runtime check 反馈闭环
- AI 输出校验
- AI 失败兜底

### 8.4 建议任务

#### 前端

- Agent 会话体验完善
- 应用 / 驳回草稿的状态管理
- 自动推进 preview
- 更明确的审核反馈

#### 后端

- 单一 agent prompt 定义
- `DatasourceContext` 组织
- tool schema 定义
- AI 返回结构解析为 `DashboardDocument` patch
- preview 失败结果结构化回流给 Agent
- schema 校验
- 有限轮次自修复和失败回退逻辑

### 8.5 完成标准

- 用户可以通过 Agent 生成布局初稿
- 用户可以通过 Agent 生成 query 和 binding 初稿
- 用户不需要手动切阶段
- Agent 能基于当前 contract 状态自主判断下一步
- preview / runtime check 失败后，Agent 能自动完成有限轮次修复
- Agent 失败时能落到高级兜底

### 8.6 非目标

- 不做自动发布
- 不做高自由度全自动 BI
- 不做与 runtime 脱节的自由文本生成

## 9. Phase 5: Save And Publish

### 9.1 目标

完成“建 -> 预览 -> 保存 -> 发布 -> 阅读”的闭环。

### 9.2 产出

- `dashboards / dashboard_drafts / dashboard_published`
- Save 接口
- Publish 接口
- Viewer 读取最新 published 快照
- 页面保存状态反馈

### 9.3 完成标准

- 用户可以创建、预览、保存和发布 Dashboard
- Viewer 能读取最新 published
- 发布前静态校验可阻止非法结构

## 10. 当前统一结论

当前阶段统一如下：

1. 文档和实现都要围绕 Agent-first 方向收敛
2. Viewer 继续保持纯只读运行时
3. Authoring 的人工操作要缩到审核和兜底范围
4. Phase 3 重点不是堆更多表单，而是把 Agent 主路径做顺
5. 最小闭环仍然是 `DashboardDocument = DashboardSpec(renderer) + QueryDef(output) + Binding(slot)`
