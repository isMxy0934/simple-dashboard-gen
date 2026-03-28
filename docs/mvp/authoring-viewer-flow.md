# Authoring And Viewer Flow v0.2

## 1. 文档定位

本文档定义 MVP 阶段的 Authoring 和 Viewer 主流程。

重点回答：

- Authoring 如何从“Agent 驱动”完成创建和修正
- Preview、Save、Publish 分别负责什么
- Viewer 如何保持纯只读阅读体验

相关文档：

- `README.md`
- `docs/mvp/dashboard-spec.md`
- `docs/mvp/query-spec.md`
- `docs/mvp/runtime-and-api.md`

## 2. 设计目标

MVP 要先跑通下面这条闭环：

1. 用户给出报表意图、SQL 或数据源信息
2. Agent 生成布局、view 和模板初稿
3. 用户只做审核和必要的布局微调
4. Agent 生成 query 和 binding
5. 系统 preview
6. 用户保存或发布
7. Viewer 只读加载并渲染

## 3. Authoring Flow

Authoring 是 Dashboard 的创建和编辑流程，但主驱动者是 Agent。

### 3.1 页面目标

Authoring 页负责：

- 创建或编辑 Dashboard
- 由 Agent 生成 layout / views / `option_template`
- 由 Agent 生成 `query_defs` / `bindings`
- 对当前本地文档执行 runtime check（preview）
- Save 和 Publish

### 3.2 页面建议结构

Authoring 页面分成三个主要区域：

- 顶部操作栏
- 左侧画布区
- 右侧 Agent 对话区

### 3.3 Agent 驱动的三种入口场景

#### 场景 A：用户已有 SQL

用户直接粘贴 SQL 或明确查询目标。

系统处理：

1. Agent 识别数据意图
2. 生成或补齐 query / binding
3. 必要时反推合适的 views 和模板

#### 场景 B：用户只有业务描述

用户描述场景，例如“做一个销售周报”。

系统处理：

1. Agent 先生成 layout / views / 模板
2. 再根据 `DatasourceContext` 生成 query / binding
3. 自动推进到 preview

#### 场景 C：用户只提供数据源

用户只说明 PostgreSQL 数据源、表或业务域。

系统处理：

1. Agent 先组织可用的数据视角
2. 生成初始 Dashboard 草稿
3. 引导用户继续补充业务目标

### 3.4 人工介入边界

人工介入只有两种：

1. 布局微调
2. Agent 多次失败后的 contract 兜底修正

具体说明：

- 布局微调发生在 `Adjust Layout` 模式
- contract 兜底发生在某个 view 的按需编辑抽屉中

不再把以下内容作为主流程：

- 手动切换 `Layout / Data`
- 手动分步驱动 query / binding
- 默认进入大量表单编辑

### 3.5 新建和编辑入口

MVP 中至少支持两种进入方式：

- 新建 Dashboard：前端初始化本地 draft
- 编辑已有 Dashboard：前端读取已有 draft 或 published 快照

建议规则：

1. 优先读取 `dashboard_drafts` 最新草稿
2. 没有草稿时回退到最新 published
3. 进入 Authoring 后一律转成本地编辑态

## 4. Authoring Preview Flow

Preview 是 Authoring 的运行时验证。

### 4.1 触发时机

- 用户点击顶部 `Run Check`
- 或 Agent 应用 data draft 后自动触发

### 4.2 前端时序

1. 读取当前本地 `dashboard_spec`
2. 读取当前本地 `query_defs`
3. 读取当前本地 `bindings`
4. 收集当前预览所需 filter 和 runtime_context
5. 调用 preview 接口

### 4.3 后端时序

1. 校验 `dashboard_spec`
2. 校验 `query_defs`
3. 校验 `bindings`
4. 解析 filter
5. 收集 query 请求并去重
6. 执行 query
7. 校验结果 schema
8. 执行 `field_mapping`
9. 返回 `binding_results`

### 4.4 前端渲染时序

1. 根据 `binding_results` 找到当前 binding 的结果
2. 读取已经完成 `field_mapping` 的 `binding_results[].data.rows`
3. 注入 `option_template.dataset.source`
4. 渲染图表或错误态

### 4.5 失败处理

Authoring 至少区分：

- AI 生成失败
- 协议校验失败
- query 执行失败
- 字段映射错误
- renderer 渲染失败
- 空数据结果

## 5. Save And Publish

### 5.1 Save

用户点击 `Save` 时：

1. 前端读取当前本地状态
2. 调用 Save 接口
3. 后端写入 `dashboard_drafts`
4. 返回 `dashboard_id` 和 `draft_id`

### 5.2 Publish

用户点击 `Publish` 时：

1. 前端读取当前本地状态
2. 调用 Publish 接口
3. 后端先做静态校验
4. 校验通过后写入 `dashboard_published`
5. 返回 `dashboard_id` 和 `publish_id`

### 5.3 Save / Preview / Publish 的边界

- `Preview` 不写数据库
- `Save` 不依赖 Preview 成功
- `Publish` 不强依赖 Preview 成功
- `Publish` 必须通过结构校验

## 6. Viewer Flow

Viewer 是 Dashboard 的只读阅读流程。

### 6.1 页面目标

Viewer 页负责：

- 加载指定 Dashboard
- 展示筛选器
- 拉取数据
- 渲染 views

Viewer 不负责：

- 布局编辑
- `option_template` 编辑
- AI 对话生成
- 调试信息展示

### 6.2 页面结构

- 顶部标题区
- 顶部筛选区
- 主内容区

### 6.3 首次加载

1. 前端根据 `dashboard_id` 请求 Dashboard 定义
2. 后端返回最新 published 版本
3. 前端初始化 filters
4. 前端收集 `visible_view_ids`、`filter_values` 和 `runtime_context`
5. 前端做 batch 请求级去重
6. 调用 query 批量执行接口
7. 后端执行 query 去重后返回 `binding_results`
8. 前端渲染各 view

### 6.4 筛选变更

1. 前端更新 filter 状态
2. 重新计算 batch 请求 key
3. 命中缓存则复用
4. 未命中则重新请求

## 7. 当前统一结论

当前阶段统一如下：

1. Authoring 主路径是 Agent 驱动，不再暴露人工阶段切换
2. 人工介入只保留布局微调和 contract 高级兜底
3. Preview 是本地文档驱动的运行时验证
4. Save 和 Publish 基于当前完整编辑态
5. Viewer 只读取已发布版本并保持纯只读展示
6. 前端统一把 `binding_results[].data.rows` 注入 `dataset.source`
