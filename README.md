# AI Dashboard Studio MVP

## 1. 文档定位

本文档是当前阶段的统一 MVP 说明，作为产品、协议、工程和研发计划的主入口。

当前仓库中原有草稿文档先保留作为参考；从 `docs/mvp` 开始，统一后的 MVP 结论以本目录文档为准。

### 1.1 推荐阅读顺序

建议按下面顺序阅读：

1. 本文档：先理解产品目标、边界和总流程
2. `docs/mvp/dashboard-spec.md`：理解最小 DashboardSpec
3. `docs/mvp/query-spec.md`：理解 QueryDef、Binding 和 SQL 约束
4. `docs/mvp/runtime-and-api.md`：理解存储、运行时、Save/Publish 和接口约定
5. `docs/mvp/tech-stack.md`：理解工程技术栈、目录组织和实现边界
6. `docs/mvp/authoring-viewer-flow.md`：理解交互和接口时序
7. `docs/mvp/ui-layout.md`：理解 Authoring / Viewer 页面布局
8. `docs/mvp/dev-plan.md`：理解实施顺序和阶段目标

如果目标是直接开始研发，建议至少先读完前 4 份。

## 1.2 Phase 4 本地测试

Phase 4 的第一版已经接入真实 LLM 流式 Agent。

本地测试前只需要补这两个环境变量：

- `OPENAI_API_KEY`
- `OPENAI_MODEL`（可选，默认 `gpt-4.1-mini`）
- `OPENAI_BASE_URL`（可选，使用第三方代理或兼容网关时填写）
- `OPENAI_API_MODE`（可选，`responses` 或 `chat`；使用兼容网关时建议 `chat`）
- `OPENAI_REASONING_EFFORT`（可选，例如 `low` / `medium` / `high`）
- `OPENAI_REASONING_SUMMARY`（可选，官方 `responses` 模式下可设 `auto` 或 `detailed`）
- `OPENAI_FORCE_REASONING`（可选，兼容网关下的“隐式 reasoning 模型”可设 `true`）

可直接复制 `.env.example` 为 `.env.local` 后填写。

说明：

- 直接连 OpenAI 官方时，可不填 `OPENAI_API_MODE`，默认走 `responses`
- 使用 DeepSeek 等 OpenAI-compatible 网关时，建议设置 `OPENAI_API_MODE=chat`
- 使用 DeepSeek 等兼容网关时，当前实现会强制把 system prompt 作为 `system` 角色发送，避免 `developer` 角色不兼容
- 如果使用 reasoning 模型，可额外设置 `OPENAI_REASONING_EFFORT`
- 如果是官方 OpenAI `responses` 模式，还可以设置 `OPENAI_REASONING_SUMMARY`
- 如果是兼容网关上的 reasoning 模型名不在 SDK 识别列表里，可设置 `OPENAI_FORCE_REASONING=true`

启动方式：

1. `npm install`
2. `npm run dev`
3. 打开 `/authoring`
4. 在右侧 Agent 面板输入需求并发送

当前测试重点：

- Agent 是否返回流式文本和 tool 事件
- Agent 是否产出可 `Apply / Dismiss` 的 suggestion
- 应用 data suggestion 后是否自动进入 runtime check
- 右侧是否能看到 runtime check 的状态摘要

## 1.3 Dashboard 管理与 PG

当前仓库已经补上了最小的 Dashboard 管理壳和 PostgreSQL 持久化基础设施：

- `/`：管理界面，左侧切换 `Authoring / Viewer`
- `/authoring?dashboardId=...`：打开指定 Dashboard 草稿
- `/viewer?dashboardId=...`：打开指定 Dashboard 快照

本地启动 PostgreSQL：

1. `docker compose up -d`
2. 确认 `.env.local` 中有：
   - `DATABASE_URL=postgres://dashboard:dashboard@localhost:5432/dashboard_studio`
3. 启动应用：`npm run dev`
4. 打开 `/`

Docker 初始化脚本会自动创建：

- `dashboards`
- `dashboard_drafts`
- `dashboard_published`

当前这三类 API 已可用：

- `GET/POST /api/dashboards`
- `GET/DELETE /api/dashboards/:dashboardId`
- `POST /api/dashboard/save`

## 2. 产品定义

AI Dashboard Studio 是一个 AI 驱动的 Dashboard 开发与运行产品。

它不是单纯的图表生成器，而是一个完整的报表工作流：

- 作者侧通过 AI 和手动编辑快速完成 Dashboard 搭建
- 阅读侧按已保存定义加载数据并渲染报表

MVP 的重点不是支持所有图表能力，而是验证这件事是否成立：

> 用户能否先完成页面布局，再通过 binding 把数据查询接到 ECharts 模板上，并最终得到一个可预览、可保存、可运行的 Dashboard。

## 3. MVP 核心原则

### 3.1 Agent 驱动的 Contract 生成

MVP 的主路径不是“用户手工填表单”，而是：

1. 用户表达需求
2. Agent 理解目标并做 plan
3. Agent 调用工具生成或修正 contract
4. 系统自动执行 runtime check
5. 用户只做审核、确认或局部兜底修改

这里的 contract 至少包含：

- `dashboard_spec`
- `views`
- `layout`
- `option_template`
- `query_defs`
- `bindings`

布局和数据仍然是两类不同产物，但它们应当是 Agent 内部工作步骤，而不是暴露给用户的人肉阶段切换。

### 3.2 View 是 ECharts 模板容器

MVP 中不再使用语义化 `kind` view。

`view` 的职责是保存不带数据的 `ECharts option_template`，以及少量页面元数据：

- `id`
- `title`
- `description`
- `option_template`

运行时再把 `binding_results[].data.rows` 注入到 `option_template.dataset.source`。

MVP 当前冻结的模板子集是：

- 单个 `dataset.source`
- 使用 `series[].encode` 声明模板字段
- 模板中不直接保存真实运行时数据

### 3.3 Binding 是中间桥梁

`binding` 的职责不是简单记录“这个 view 用哪条 SQL”，而是建立完整映射关系：

- `view_id -> query_id`
- query 运行时参数如何传入
- query 返回字段如何映射到图表模板字段

### 3.4 Query 使用参数化 SQL 模板

MVP 中的数据查询定义应保存为可参数化 SQL 模板，而不是一次性写死的最终 SQL。

这样才能支撑：

- 时间范围切换
- 基础筛选
- 后续阅读态动态重载数据

### 3.5 ECharts 是渲染引擎，也是模板承载格式

ECharts 既是运行时渲染引擎，也是 `view.option_template` 的持久化格式。

系统的主存储应保留语义化对象：

- 页面结构
- view 模板
- query 定义
- binding 关系

运行时再把数据注入，生成最终的 ECharts option。

## 4. 用户流程

### 4.1 Authoring Flow

作者侧开发 Dashboard 的流程如下：

1. 创建一个新的 Dashboard
2. 用户向 Agent 描述需求、粘贴 SQL，或说明数据源
3. Agent 生成 plan，并调用工具创建或修正 `DashboardDocument`
4. 用户只在必要时微调 layout 或单个 view
5. 系统自动或显式执行 runtime check，并返回 `binding_results`
6. 用户确认结果后保存或发布 Dashboard

### 4.2 Viewer Flow

阅读侧使用流程如下：

1. 用户打开某个 Dashboard
2. 系统读取已保存的 Dashboard 定义
3. 前端提交 batch 执行上下文，例如 `visible_view_ids + filter_values + runtime_context`
4. 后端解析 filter、执行 query，并返回结果和 `binding_results`
5. 前端根据 `binding_results[].data.rows` 渲染 ECharts

阅读态的职责应尽量简单：

- 加载定义
- 加载数据
- 渲染视图

MVP 中不把阅读态做成复杂编辑器。

## 5. 核心对象

MVP 阶段建议明确三类核心持久化对象。

### 5.1 DashboardSpec

`DashboardSpec` 用于描述页面本身。

它至少包含：

- dashboard 展示元数据
- layout
- views
- filters

它回答的问题是：

- 页面上有什么
- 每个 view 放在哪
- 每个 view 的 ECharts 模板是什么

### 5.2 QueryDef

`QueryDef` 用于描述数据查询。

它至少包含：

- `id`
- `datasource_id`
- 参数化 SQL 模板
- 参数定义
- 返回字段 schema

它回答的问题是：

- 数据从哪里来
- 用什么 SQL 取
- SQL 需要哪些参数
- 结果会返回哪些字段

### 5.3 Binding

`Binding` 用于描述 view 和 query 的连接关系。

它至少包含：

- `view_id`
- `query_id`
- 参数映射规则
- 字段映射规则

它回答的问题是：

- 这个 view 用哪条 query
- view 所需参数如何传给 query
- query 的结果列如何映射到模板字段

## 6. 建议的数据分层

为避免把“结构定义”和“运行结果”混在一起，建议采用下面的分层：

### 6.1 持久化主数据

应作为长期保存对象：

- `dashboard_spec`
- `query_defs`
- `bindings`

### 6.2 运行时数据

运行时临时生成：

- query 执行结果
- `binding_results[].data.rows`
- 最终 ECharts option

### 6.3 可选缓存

如果后续有性能需求，可以增加：

- query result cache
- render cache

但缓存不是主真相来源。

## 7. View 的职责边界

一个 view 的职责是表达“一个可渲染的 ECharts 模板”，而不是直接固化最终渲染结果。

一个 view 通常需要描述：

- `id`
- `title`
- `description`
- `option_template`

不建议在持久化主数据里直接保存填满 data 的最终 ECharts option。

更合理的过程是：

1. view 定义 ECharts 模板
2. binding 将 query 输出映射成模板字段
3. 运行时把 `rows` 注入 `dataset.source`
4. renderer 生成最终 option

## 8. MVP 范围

### 8.1 MVP 应该包含

- 新建 Dashboard
- 单 Agent 驱动的 Dashboard 搭建流程
- Agent 生成布局和 view 模板初稿
- Agent 生成参数化 SQL 模板和 binding 初稿
- 手动调整布局
- 单个 view 的高级兜底编辑
- runtime check / 预览渲染
- 保存 Dashboard
- 阅读态加载并渲染 Dashboard

### 8.2 MVP 暂不追求

- 全量 BI 能力
- 任意复杂可视化类型的完整支持
- 复杂权限系统
- 多人协作编辑
- 完整的版本管理体系
- 复杂发布审批流程

## 9. 预览通过标准

在 Authoring Flow 中，预览不是简单“图显示出来就算成功”，至少要满足以下条件：

- SQL 模板可执行
- filter 解析和参数绑定正确
- 返回字段符合 binding 预期
- `rows` 能正确注入到 ECharts 模板
- 空数据或异常数据有兜底表现

只有通过这些检查后，保存才更有意义。

## 10. 当前统一结论

当前阶段，团队应先统一接受以下结论：

1. Dashboard 的主路径是 Agent 驱动的 contract 生成与修正
2. `view` 是不带数据的 ECharts 模板容器，不再使用语义化 `kind`
3. 布局和数据仍然是两类 contract，但它们应当成为 Agent 内部步骤，不再暴露成人工阶段切换
4. binding 将 view 和 query 连接起来，MVP 先冻结为 `0..1 binding`
5. Query 必须是参数化 SQL 模板，并通过 prepared statement 执行
6. MVP 当前真实查询数据库先冻结为 `PostgreSQL`
7. SQL 执行必须具备最小安全边界，例如只读、单语句、超时和结果上限
8. `time_range` 等 filter 先解析为 resolved values，再进入 binding 参数映射
9. `field_mapping` 由后端运行时执行，前端直接消费 `binding_results[].data.rows`
10. Save 写入 `dashboard_drafts`，Publish 写入 `dashboard_published`，两者物理分离
11. `schema_version` 和 Dashboard 保存版本 `version` 必须分开
12. ECharts 是渲染层，也是模板持久化格式，不是主协议数据本身
13. Dashboard 的运行流程是“读取定义 -> 获取数据 -> 渲染”
14. Agent 的职责是通过工具产出 contract，而不是绕开 contract 直接输出最终 UI

## 11. 实施前最小检查项

在正式开始研发前，建议先确认下面这些点已经被团队接受：

1. `DashboardSpec` 的最小结构已冻结
2. `view` 的最小结构已冻结为 `id + title + description + option_template`
3. `QueryDef` / `Binding` / `DatasourceContext` 已冻结
4. MVP 支持的 ECharts 模板子集已冻结为 `dataset.source + series[].encode`
5. Preview 和 Viewer 的返回结构已约定 `binding_results[].data.rows`
6. 三表存储结构已确认：`dashboards` / `dashboard_drafts` / `dashboard_published`
7. Publish 前必须保证 layout 中所有 view 都具备唯一 binding
8. SQL 执行安全边界已接受
9. MVP 先不做 multi-query view
10. 工程形态已确定为 `Next.js + Route Handlers` 单仓单应用

### 11.1 当前 Contracts 落点

当前仓库中与 Phase 0 对应的 contracts 骨架位于：

- `contracts/dashboard.ts`
- `contracts/api.ts`
- `contracts/validation.ts`

## 12. 文档地图

当前 `docs/mvp` 下各文档职责如下：

- `docs/mvp/dashboard-spec.md`
- `docs/mvp/query-spec.md`
- `docs/mvp/authoring-viewer-flow.md`
- `docs/mvp/runtime-and-api.md`
- `docs/mvp/tech-stack.md`
- `docs/mvp/ui-layout.md`
- `docs/mvp/dev-plan.md`

- 本文档负责统一目标、流程和边界
- `dashboard-spec.md` 负责最小页面结构协议
- `query-spec.md` 负责 SQL 模板、Binding 和安全边界
- `authoring-viewer-flow.md` 负责交互和接口时序
- `runtime-and-api.md` 负责运行时架构、存储和 API 约定
- `tech-stack.md` 负责工程技术栈和实现边界
- `ui-layout.md` 负责页面线框和工作台布局
- `dev-plan.md` 负责研发阶段和实施顺序
