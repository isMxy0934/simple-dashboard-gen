# MVP Tech Stack v0.1

## 1. 文档定位

本文档用于冻结 MVP 阶段的工程实现技术栈和基础目录约束。

它回答下面几个问题：

- 前端和后端分别用什么技术
- 哪些基础库是当前确定要用的
- 哪些库当前明确不引入
- 项目目录建议如何组织
- 这些选择如何对应 MVP 的研发阶段

相关文档：

- `README.md`
- `docs/mvp/runtime-and-api.md`
- `docs/mvp/ui-layout.md`
- `docs/mvp/dev-plan.md`

## 2. 当前确认的技术栈

MVP 当前确认采用下面这套实现方案：

- `Next.js`
- `React`
- `TypeScript`
- `PostgreSQL`
- `Ant Design`
- `react-grid-layout`
- `ECharts`
- `Vercel AI SDK`

这是当前阶段的默认实现方案。

在没有新的明确结论之前，不额外引入第二套主 UI 框架。

## 3. 选型原则

本次选型遵循下面几个原则：

1. 优先与现有生产系统一致
2. 优先支持 MVP 闭环，而不是追求抽象完整
3. 优先选择团队熟悉、可快速落地的技术
4. 只为当前明确需要的能力引库

## 4. 各技术职责

### 4.1 Next.js

`Next.js` 作为应用骨架，负责：

- 页面路由
- 服务端接口
- 本地开发和构建
- Authoring / Viewer 页面承载

MVP 阶段采用单仓启动，优先降低工程摩擦。

当前冻结的工程形态为：

- 一个仓库
- 一个 `Next.js` 应用
- 页面和接口都在同一应用内
- 后端能力通过 `Route Handlers` 提供
- 目录对应 `app/api/*`

### 4.2 React + TypeScript

`React + TypeScript` 作为前端基础运行时，负责：

- 页面组件开发
- 本地编辑态状态管理
- Viewer 运行态渲染
- 协议对象和接口类型约束
- `view.option_template` 的编辑和校验
- `binding_results[].data.rows` 到 `dataset.source` 的转换

### 4.3 Ant Design

`Ant Design` 作为默认 UI 组件层，负责：

- 页面框架
- 表单输入
- 按钮、标签、弹层、抽屉、Tabs
- 反馈态和基础业务容器

MVP 中推荐：

- Viewer 页使用 `Ant Design` 组织标题区、筛选区、卡片容器
- Authoring 页使用 `Ant Design` 组织顶部栏、侧边栏、属性面板

## 4.4 react-grid-layout

`react-grid-layout` 作为 Authoring 画布布局引擎，负责：

- view 的拖拽和缩放
- Desktop / Mobile 两套布局切换
- 栅格坐标维护

它对应 `DashboardSpec.layout` 的编辑能力，而不是页面整体 UI 框架。

### 4.5 ECharts

`ECharts` 作为图表渲染引擎，负责：

- 所有 dashboard view 的最终渲染
- 作为 `view.option_template` 的持久化格式
- 运行时根据 binding 结果和模板生成最终渲染配置

需要再次强调：

- `ECharts` 是运行时渲染层
- `DashboardSpec.views[].option_template` 不是带数据的完整 ECharts option

### 4.6 PostgreSQL

`PostgreSQL` 作为 MVP 当前唯一冻结的真实查询数据库，负责：

- 承载参数化 SQL 模板的真实执行
- 与服务端 prepared statement 编译链路对齐，例如 `$1`、`$2`
- 支撑 Preview 和 Viewer 的统一查询运行时

当前阶段不额外为多数据库方言抽象统一驱动层。

### 4.7 Vercel AI SDK

`Vercel AI SDK` 作为 Agent 交互层和流式协议层，负责：

- Authoring 右侧 Agent 面板的流式 chat 体验
- SSE / UI message stream
- tool calling 和工具执行回传
- Agent 与前端之间的结构化消息流

当前引入它的原因不是为了“聊天 UI”，而是为了支撑：

- 单 Agent 驱动的 Dashboard authoring
- plan -> tool execution -> artifact update 的流式反馈
- 自动 runtime check 结果的实时回传

MVP 中建议采用：

- `ai`
- `@ai-sdk/react`
- `@ai-sdk/openai`

### 4.8 当前明确不引入 LangChain / LangGraph

当前阶段不默认引入：

- `LangChain`
- `LangGraph`

原因：

- 当前只需要单 Agent
- 当前核心难点是 contract artifact、tool schema 和 runtime check
- 暂未进入需要 durable execution、多 agent 编排、复杂持久化工作流的阶段

如果后续进入复杂长流程代理系统，再单独评估是否补充。

## 5. 当前明确不引入的内容

MVP 当前不把下面这些作为默认基础设施：

- `Tailwind CSS`
- `shadcn/ui`
- `Radix UI`
- 第二套主设计语言

原因不是这些技术不可用，而是当前阶段没有必要。

本项目已经明确采用 `Ant Design` 作为主 UI 体系。

如果后续确实出现 `Ant Design` 无法满足的局部交互，再按点补充，不在当前阶段默认引入。

## 6. 推荐目录结构

MVP 阶段建议采用单仓结构，先以一个 web app 为核心：

```text
/app
/components
/lib
/types
/docs
```

进一步落地时，建议按职责拆分为：

```text
/app
  /viewer
  /authoring
  /api
/client
  /authoring
  /viewer
  /management
/components
/server
  /agent
  /dashboards
  /datasource
  /runtime
/ai
/domain
/contracts
/shared
```

说明：

- `app` 承载页面和 API 路由入口
- `client` 承载前端业务功能
- `components` 放跨业务复用组件
- `server` 放后端逻辑和运行时链路
- `ai` 放智能体相关能力
- `domain` 放纯业务规则
- `contracts` 放 schema、type 和协议校验
- `shared` 放通用工具

当前不建议为了 MVP 额外拆分独立的前后端仓库或独立的 API 服务。

## 7. 与 MVP 阶段的对应关系

### 7.1 Phase 0: Contracts Freeze

优先产出：

- `DashboardSpec` 最小结构
- `QueryDef` / `Binding` 最小结构
- `TypeScript` 类型
- schema 校验
- Runtime 请求和响应结构

### 7.2 Phase 1: Viewer Runtime First

优先使用：

- `Next.js API`
- `Ant Design`
- `ECharts`

目标是先跑通：

- 读取定义
- 批量执行
- `rows` 映射到 `dataset.source`
- Viewer 渲染

### 7.3 Phase 2: Authoring Layout First

优先使用：

- `Ant Design`
- `react-grid-layout`

目标是先跑通：

- 画布布局编辑
- view 新增、删除、选择
- Desktop / Mobile 布局切换
- `option_template` 模板编辑入口

### 7.4 Phase 3: Query And Binding

优先完善：

- Preview API
- Binding 编辑 UI
- 结构化错误提示
- `field_mapping` 校验
- `binding_results[].data.rows` 校验

### 7.5 Phase 4: Agent-Driven Flow

Agent 接入必须建立在已有协议和已有页面之上。

Agent 不应绕开：

- `DashboardSpec`
- `QueryDef`
- `Binding`
- `view.option_template`
- Preview Runtime

这一阶段的技术边界是：

- prompt 用于定义单 Agent 的能力边界和行为原则
- tools 用于定义 Agent 可执行的动作集合
- `DashboardDocument` 作为唯一核心 artifact
- Agent 通过 artifact 当前状态判断下一步，而不是通过多套 prompt 分流
- preview / runtime check 结果必须能以结构化方式回流给 Agent

这一阶段优先使用：

- `Vercel AI SDK`
- `@ai-sdk/openai`

目标是先跑通：

- `/api/agent/chat` 流式接口
- 单 Agent plan / tool / apply
- UI message stream
- tool 调用结果落到 `DashboardDocument`
- 自动 runtime check

### 7.6 Phase 5: Save And Publish

最后补齐：

- 持久化
- `dashboards / dashboard_drafts / dashboard_published` 三表模型
- Save 追加草稿记录
- Publish 追加发布快照
- Viewer 默认读取最新 published 快照

## 8. 当前工程边界结论

当前工程边界明确如下：

- 使用 `Next.js + React + TypeScript + Ant Design + react-grid-layout + ECharts + Vercel AI SDK`
- 当前真实查询数据库先冻结为 `PostgreSQL`
- 工程形态采用 `Next.js + Route Handlers` 单仓单应用
- 不额外引入第二套主 UI 框架
- 当前不默认引入 `LangChain / LangGraph`
- 不把带数据的图表配置当成存储真相源
- `view.option_template` 是模板真相源，`binding_results[].data.rows` 是运行时数据真相源
- 先做 Viewer Runtime，再做 Authoring，再接单 Agent 驱动流程

这份文档用于约束 MVP 起步阶段的工程方向。

如果后续需要调整，应直接修改本文件并同步更新相关研发计划。
