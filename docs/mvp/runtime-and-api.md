# Runtime And API v0.2

## 1. 文档定位

本文档定义 MVP 阶段的运行时架构、存储方式和前后端 API 边界。

本文档重点回答：

- Dashboard 如何存储和读取
- Preview / Save / Publish / Read / Execute-batch 分别怎么工作
- Agent Chat 和 tool execution 如何工作
- 前后端如何围绕 `binding_results` 传递数据
- 请求级错误和局部执行错误如何区分

本文档不重复定义：

- `DashboardSpec` 的页面结构细节
- `QueryDef` 和 `Binding` 的完整字段定义
- 最终 renderer 组件实现细节

相关文档：

- `README.md`
- `docs/mvp/dashboard-spec.md`
- `docs/mvp/query-spec.md`

## 2. 总体架构

MVP 在工程形态上采用 `Next.js` 单仓单应用方案。

也就是说：

- 前端页面和后端接口位于同一个仓库
- 页面层使用 `Next.js + React`
- 服务端接口通过 `Next.js Route Handlers` 提供
- 所有数据库访问都发生在服务端
- MVP 当前真实查询数据库冻结为 `PostgreSQL`

### 2.1 前端职责

前端负责：

- Authoring 页面
- Viewer 页面
- 本地编辑态状态管理
- Agent UI message stream 消费
- runtime check 和保存触发
- 批量请求去重
- 将 `binding_results[].data.value` 注入 `renderer.slots[].path`

### 2.2 后端职责

后端负责：

- Dashboard 数据持久化
- 已保存 Dashboard 读取
- 单 Agent 编排
- tool 调用执行
- 参数化 SQL 模板执行
- SQL 模板编译为 prepared statement
- query 参数注入与校验
- 批量执行和去重
- 按 `QueryDef.output`、`Binding.field_mapping`、`Binding.result_selector` 生成 `binding_results[].data`

### 2.3 明确边界

浏览器不直接连接数据库。

所有 SQL 执行都通过 `Next.js` 服务端运行时完成。

`runtime_context` 只保留非敏感上下文，例如：

- `timezone`
- `locale`

多租户运行时隔离协议不在 MVP 范围内，不应出现在前端请求体中。

### 2.4 Agent 驱动的运行边界

MVP 中的 Agent 不是自由输出文本的聊天机器人，而是一个围绕 `DashboardDocument` 工作的 orchestrator。

它的职责是：

1. 接收用户需求
2. 在 `approval / chat / authoring` 三种运行时路径之间分流
3. 在 authoring 路径下驱动单个 `ToolLoopAgent`
4. 调用工具读取、起草和组合 patch proposal
5. 触发 runtime check / repair
6. 将 route、tool trace、proposal 和 runtime 状态通过流式消息回传给前端

这里必须明确：

- Agent 不直接绕开 contract 输出最终页面
- Agent 的所有有效结果都必须落成 `DashboardDocument` 或 patch
- 真正执行修改的是 tools，不是自由文本
- prompt 只定义 Agent 能做什么、如何判断和如何约束自己
- tools 才定义 Agent 真正能执行哪些动作
- 运行时代码负责 route、approval state 和 active tools，Agent 只在当前边界内决策
- approval 使用 AI SDK 原生 tool approval，运行时只负责透传 message state，不再维护自定义审批协议
- runtime check 的结构化结果应当可以作为下一轮 Agent 输入

## 2.5 Agent Chat API

Phase 4 建议增加：

- `POST /api/agent/chat`

这个接口负责：

- 接收当前编辑态 `DashboardDocument`
- 接收用户输入消息
- 创建或恢复单 Agent 会话
- 以 SSE / UI message stream 形式返回：
  - 文本说明
  - 当前 route decision
  - tool 调用状态
  - patch / artifact 更新
  - runtime check 状态

建议原则：

- `POST /api/agent/chat` 不直接写数据库
- 它的主要产物是新的 draft / patch，而不是 Save 行为
- Save / Publish 仍然走独立接口
- 当 runtime check 失败时，接口应能把结构化错误摘要重新回流给 Agent
- Agent 自动修复应限制轮次，避免失控循环

## 3. 存储模型

### 3.1 MVP 结构

MVP 采用三张独立的表存储 Dashboard 数据。

#### 表 1：`dashboards`（主表，身份记录）

每个 Dashboard 一行，只存稳定的展示元数据。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | 主键，Dashboard 唯一标识 |
| `name` | TEXT NOT NULL | Dashboard 名称 |
| `description` | TEXT | 简短说明 |
| `is_enabled` | BOOL DEFAULT true | 是否对阅读者可见 |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `updated_at` | TIMESTAMPTZ | 最后更新时间 |

#### 表 2：`dashboard_drafts`（草稿表，每次 Save 追加一行）

每次用户点击 Save 写入一条新记录，保留完整草稿历史。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | 草稿唯一标识 |
| `dashboard_id` | UUID FK → dashboards.id | 所属 Dashboard |
| `version` | INT | 该 Dashboard 下的草稿序号，递增 |
| `spec_json` | JSONB NOT NULL | DashboardSpec |
| `query_defs_json` | JSONB NOT NULL | QueryDef[] |
| `bindings_json` | JSONB NOT NULL | Binding[] |
| `saved_at` | TIMESTAMPTZ | 保存时间 |

#### 表 3：`dashboard_published`（发布表，每次 Publish 追加一行）

每次用户发布写入一条新记录，保存发布时刻的完整快照。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | 发布记录唯一标识 |
| `dashboard_id` | UUID FK → dashboards.id | 所属 Dashboard |
| `version` | INT | 该 Dashboard 下的发布序号，递增 |
| `draft_id` | UUID FK → dashboard_drafts.id | 来源草稿 |
| `spec_json` | JSONB NOT NULL | DashboardSpec 快照 |
| `query_defs_json` | JSONB NOT NULL | QueryDef[] 快照 |
| `bindings_json` | JSONB NOT NULL | Binding[] 快照 |
| `published_at` | TIMESTAMPTZ | 发布时间 |

### 3.2 设计说明

#### 三表职责分离

- `dashboards`：身份记录，稳定，低频写
- `dashboard_drafts`：编辑历史，每次 Save 追加，高频写
- `dashboard_published`：发布快照，每次 Publish 追加，低频写，读取稳定

草稿和已发布版本在物理上完全分离，互不干扰。

#### 草稿历史保留策略

MVP 阶段保留全部草稿历史，每次 Save 只做 INSERT，不做 UPSERT。

好处是：

- 实现最简单，无需判断
- 天然支持后续草稿回溯能力，不需要改表结构

#### 发布快照策略

发布时把当前完整内容复制到 `dashboard_published`，而不是只保存引用。

好处是：

- 草稿继续修改不会影响已发布内容
- Viewer 读取路径简单，不需要跨表 JOIN

#### 真相源规则

- `dashboards` 是 Dashboard 身份和元数据的唯一真相源
- `dashboard_drafts` 是编辑内容的唯一真相源
- `dashboard_published` 是阅读态内容的唯一真相源
- `spec_json / query_defs_json / bindings_json` 在各自表中均为内容真相源

### 3.3 读取规则

- Viewer 读取：`dashboard_published` WHERE dashboard_id = ? ORDER BY version DESC LIMIT 1
- Authoring 编辑已有 Dashboard：`dashboard_drafts` WHERE dashboard_id = ? ORDER BY version DESC LIMIT 1
- 如果 `dashboard_drafts` 无记录，回退读取最新已发布版本
- Viewer 读取前先检查 `dashboards.is_enabled`，为 false 时返回已下线提示

## 4. 运行时模型

### 4.1 统一对象流

MVP 的数据流是：

1. 读取 `DashboardSpec`
2. 读取 `QueryDef[]`
3. 读取 `Binding[]`
4. 解析 `filter_values`
5. 合成 `effective_runtime_context`
6. 根据 `Binding.param_mapping` 组装 query 参数
7. 执行 SQL
8. 用 `QueryDef.output` 校验结果
9. 根据 `Binding.field_mapping` / `Binding.result_selector` 生成最终 slot value
10. 返回 `binding_results`
11. 前端将 `binding_results[].data.value` 注入 `renderer.slots[].path`

### 4.2 `runtime_context`

`runtime_context` 只接收客户端可提供的非敏感上下文，例如：

- `timezone`
- `locale`

当前允许键冻结为：

- `timezone`
- `locale`

服务端在执行前会合成 `effective_runtime_context`。

如果后续要接入租户、权限、用户身份等信息，它们必须由服务端注入，不通过前端请求体传递。

### 4.3 `binding_results`

`binding_results` 是前端渲染的主输入。

`binding_results` 的 key 直接使用 `binding_id`。

每个 binding 的结果统一包含：

- `view_id`
- `slot_id`
- `query_id`
- `status`
- `data`

当 `status = ok` 或 `status = empty` 时：

- `data` 必须存在
- `data` 至少包含 `{ "value": ... }`
- rows 型输出可额外保留 `{ "rows": [...] }` 便于调试和预览

当 `status = error` 时：

- 可以返回 `code`
- 可以返回 `message`
- 不需要再返回 `data`

### 4.4 Slot Injection

运行时不再假设所有图都统一走 `dataset.source`。

规则是：

- 每个 `view` 显式声明 `renderer.slots[]`
- 每个 `binding` 显式声明 `slot_id`
- 后端返回的主值统一放在 `binding_results[].data.value`
- rows 型输出可以继续通过 `field_mapping` 转成模板字段
- 如需从 query output 中裁剪子结构，使用 `result_selector`
- 前端或服务端 renderer 统一按 `slot.path` 注入数据

## 5. 响应外壳

### 5.1 标准外壳

MVP 的所有 API 统一使用：

```json
{
  "status_code": 200,
  "reason": "OK",
  "data": {}
}
```

### 5.2 请求级失败

当请求本身不合法时，直接返回外层错误，`data` 为 `null`。

例如：

```json
{
  "status_code": 400,
  "reason": "INVALID_PAYLOAD",
  "data": null
}
```

常见请求级错误包括：

- `INVALID_PAYLOAD`
- `NOT_FOUND`
- `INTERNAL_ERROR`

### 5.3 局部执行失败

当请求本身合法，但某些 binding 执行失败时：

- 外层保持 `200 / OK`
- 失败信息放在 `binding_results` 内
- 前端按 binding 级别渲染局部错误态

## 6. API 设计

### 6.1 Preview

接口用途：

- 用于 Authoring 页面基于本地状态预览

建议接口：

- `POST /api/dashboard/preview`

请求体：

```json
{
  "dashboard_spec": {},
  "query_defs": [],
  "bindings": [],
  "filter_values": {},
  "runtime_context": {}
}
```

规则：

- Preview 不依赖先保存到数据库
- Preview 会先做结构校验，再做 query 执行
- Preview 失败不影响后续 Save
- Preview 失败也不阻止结构合法的 Publish

响应体：

```json
{
  "status_code": 200,
  "reason": "OK",
  "data": {
    "binding_results": {
      "b_sales_trend": {
        "view_id": "v_sales_trend",
        "query_id": "q_sales_trend",
        "status": "ok",
        "data": {
          "rows": [
            { "week": "2026-W01", "gmv": 1200 }
          ]
        }
      },
      "b_sales_region": {
        "view_id": "v_sales_region",
        "query_id": "q_sales_region",
        "status": "error",
        "code": "RESULT_SCHEMA_MISMATCH",
        "message": "result schema mismatch"
      }
    }
  }
}
```

### 6.2 Save

接口用途：

- 保存当前编辑内容为新的 `draft` 版本

建议接口：

- `POST /api/dashboard/save`

请求体：

```json
{
  "dashboard_id": "db_sales_weekly_001",
  "dashboard_spec": {},
  "query_defs": [],
  "bindings": []
}
```

规则：

- `dashboard_id` 为空表示新建
- Save 不依赖 Preview 成功
- Save 只要求结构合法
- Save 成功后在 `dashboard_drafts` 追加一条新记录并返回 `draft_id`

响应体：

```json
{
  "status_code": 200,
  "reason": "OK",
  "data": {
    "dashboard_id": "db_sales_weekly_001",
    "draft_id": "dft_abc123",
    "draft_version": 3
  }
}
```

### 6.3 Publish

接口用途：

- 生成新的 `published` 版本

建议接口：

- `POST /api/dashboard/publish`

请求体与 Save 一致。

规则：

- Publish 不依赖 Preview 成功
- Publish 必须通过结构校验
- Publish 成功后生成新的 `published` 版本

响应体：

```json
{
  "status_code": 200,
  "reason": "OK",
  "data": {
    "dashboard_id": "db_sales_weekly_001",
    "publish_id": "pub_xyz789",
    "publish_version": 4
  }
}
```

### 6.4 Read

接口用途：

- 读取某个 Dashboard 的已保存定义

建议接口：

- `GET /api/dashboard/:dashboardId`

可选 query：

- `version`
- `status`

规则：

- 如果未指定，Viewer 默认读取最新 `published` 版本
- Authoring 编辑已有 Dashboard 时优先读取最新 `draft`
- 如果没有 `draft`，则回退读取最新 `published`

响应体：

```json
{
  "status_code": 200,
  "reason": "OK",
  "data": {
    "dashboard_id": "db_sales_weekly_001",
    "version": 4,
    "status": "published",
    "updated_at": "2026-03-19T10:30:00+08:00",
    "dashboard_spec": {},
    "query_defs": [],
    "bindings": []
  }
}
```

### 6.5 Execute-batch

接口用途：

- 批量执行 Viewer 所需 query

建议接口：

- `POST /api/query/execute-batch`

请求体：

```json
{
  "dashboard_id": "db_sales_weekly_001",
  "version": 3,
  "visible_view_ids": ["v_sales_trend", "v_sales_region"],
  "filter_values": {
    "f_time_range": "last_12_weeks"
  },
  "runtime_context": {
    "timezone": "Asia/Shanghai",
    "locale": "zh-CN"
  }
}
```

规则：

- 后端根据 `dashboard_id + version` 读取 `query_defs` 和 `bindings`
- 后端根据 `filter_values` 解析 resolved values
- 后端补齐服务端 `effective_runtime_context`
- 后端根据 `visible_view_ids` 过滤需要执行的 bindings
- 后端执行去重后返回 `binding_results`

响应体：

```json
{
  "status_code": 200,
  "reason": "OK",
  "data": {
    "binding_results": {
      "b_sales_trend": {
        "view_id": "v_sales_trend",
        "query_id": "q_sales_trend",
        "status": "ok",
        "data": {
          "rows": [
            { "week": "2026-W01", "gmv": 1200 }
          ]
        }
      },
      "b_sales_region": {
        "view_id": "v_sales_region",
        "query_id": "q_sales_region",
        "status": "empty",
        "data": {
          "rows": []
        }
      }
    }
  }
}
```

## 7. 校验边界

### 7.1 请求级校验

以下情况应直接返回外层错误：

- 请求体缺失必填字段
- `dashboard_spec` 不合法
- `query_defs` 不合法
- `bindings` 不合法
- `runtime_context` 包含未允许的键
- 指定的 Dashboard 不存在

### 7.2 结构校验

Save 和 Publish 至少需要通过以下校验：

- `schema_version` 存在
- `dashboard.name` 非空
- `views[].id` 在 `DashboardSpec` 内唯一
- `layout.items[].view_id` 必须引用已存在的 `views[].id`
- `views[].renderer.option_template` 不应直接保存真实运行时数据，例如 `dataset.source`、`series[].data`、`xAxis.data`
- `views[].renderer.slots[]` 必须存在
- `views[].renderer.slots[].path` 必须可解析
- `QueryDef.sql_template` 中的参数必须在 `params` 中声明
- `Binding.view_id` 必须存在
- `Binding.query_id` 必须存在
- `Binding.param_mapping` 中的参数必须在 `QueryDef.params` 中声明
- `Binding.slot_id` 必须存在且引用已声明 slot

Publish 额外需要通过以下校验：

- 所有出现在 `layout.items` 中的 `view_id` 的 required slot 都必须有 binding
- 每个 binding 的 `query_id` 都必须能解析到某个 `QueryDef`
- 如果使用 `Binding.field_mapping`，它必须与 rows 型 output 和模板字段集合兼容

### 7.3 SQL 安全边界

后端执行 SQL 时必须满足：

- 只允许单条查询语句
- 只允许只读查询
- 不允许 DDL / DML / 事务控制语句
- 需要设置超时，例如 `15s`
- 需要设置结果行数上限，例如 `5000 rows`

### 7.4 运行时校验

Preview 和 Execute-batch 在执行阶段还需要校验：

- 参数是否齐全
- 参数类型是否合法
- 返回结果是否符合 `QueryDef.output`
- `binding_results[].data.value` 是否能注入 `slot.path`

执行失败时：

- 请求本身合法则保持 `200 / OK`
- 失败结果写入对应 `binding_results`

## 8. 前端运行建议

前端渲染流程建议如下：

1. 读取当前 Dashboard 定义
2. 收集当前可见 view、filter_values 和 runtime_context
3. 按 `dashboard_version + normalized_filter_values + normalized_runtime_context + visible_view_ids` 去重
4. 调用后端批量执行接口
5. 读取 `binding_results`
6. 将 `binding_results[].data.value` 注入 `renderer.slots[].path`
7. 交给 ECharts 渲染

## 9. 非目标

当前版本暂不强制实现：

- 服务端 query result 缓存
- 分布式任务调度
- 异步报表生成任务
- 完整版本历史管理页面
- 审批流和权限流
- 多租户运行时隔离协议

## 10. 当前统一结论

当前关于运行时和 API 的统一结论如下：

1. 工程上采用 `Next.js` 单仓单应用
2. 前端负责编辑、渲染和请求级去重
3. 后端负责存储、SQL 执行和 slot-based data shaping
4. `runtime_context` 只保留非敏感上下文
5. Save 不依赖 Preview 成功
6. Publish 不依赖 Preview 成功，但必须通过结构校验
7. 统一响应外壳使用 `status_code / reason / data`
8. 局部执行失败保留在 `binding_results`
9. `binding_results[].data` 统一以 `value` 为主，rows 型输出可附带 `rows`
10. 前端统一将 `binding_results[].data.value` 注入 `renderer.slots[].path`
