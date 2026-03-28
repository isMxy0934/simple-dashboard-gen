# QuerySpec And Binding v0.2

## 1. 文档定位

本文档定义 MVP 阶段的数据查询协议与 `binding` 结构。

本文档覆盖：

- `QueryDef`
- query 参数定义
- query 输出形状
- `Binding`
- view slot 和 query 的映射关系

本文档不覆盖：

- Dashboard 页面布局
- view 的 ECharts 模板结构
- 最终 renderer 生成逻辑

## 2. 设计原则

### 2.1 Query 是参数化模板，不是最终死 SQL

MVP 中所有 query 都应保存为参数化 SQL 模板。

不能保存为只适用于一次预览的静态 SQL。

### 2.2 Binding 是显式结构，不靠猜

系统不能依赖“字段名差不多就自动对上”，也不能依赖“所有图都默认吃 `dataset.source`”。

`binding` 必须显式定义：

- 用哪条 query
- 填充哪个 view slot
- 传哪些参数
- query 输出如何注入 renderer 声明的 slot

### 2.3 Query 和 View 解耦

同一条 query 可以服务多个 view，甚至服务同一个 view 的多个 slot。

同一个 view 也可以在后续版本中替换成新的 query，而不必重建整个 layout。

### 2.4 Query 和 Binding 是 Agent 产物，不是自由文本

在当前产品方向下，`QueryDef` 和 `Binding` 的主生成路径应当是：

1. Agent 理解用户需求
2. Agent 基于 `DatasourceContext` 做 plan
3. Agent 调用工具生成或修正 `QueryDef` / `Binding`
4. 系统校验后进入 runtime check

因此必须明确：

- Agent 不能只返回一段 SQL 说明文字
- Agent 的有效输出必须是结构化对象或 patch
- `QueryDef` / `Binding` 始终是 contract 的一部分
- 手工编辑只作为高级兜底模式保留

## 3. 顶层对象

MVP 建议使用两类对象：

- `QueryDef`
- `Binding`

在持久化时可以作为：

- `query_defs[]`
- `bindings[]`

与 `DashboardSpec` 一起保存。

### 3.1 AI Query Generation Context

当系统让 AI 生成 `QueryDef` 时，不能只给一段自然语言需求。

MVP 至少需要提供一份结构化的 `DatasourceContext`，作为 AI 生成 SQL 的上下文输入。

建议结构：

```json
{
  "datasource_id": "ds_sales",
  "dialect": "postgres",
  "tables": [
    {
      "name": "sales",
      "description": "订单级销售事实表",
      "fields": [
        { "name": "order_date", "type": "date", "semantic_type": "time", "filterable": true },
        { "name": "region", "type": "string", "semantic_type": "dimension", "filterable": true },
        { "name": "gmv", "type": "number", "semantic_type": "metric", "aggregations": ["sum", "avg"] }
      ]
    }
  ],
  "metrics": [
    {
      "id": "gmv",
      "label": "GMV",
      "description": "成交总额",
      "default_aggregation": "sum"
    }
  ],
  "visibility_scope": {
    "allowed_tables": ["sales"],
    "allowed_fields": ["order_date", "region", "gmv"]
  }
}
```

MVP 中建议至少包含：

- `datasource_id`
- `dialect`
- 可见表和字段
- 字段类型和语义类型
- 指标定义
- 可见范围

没有这类上下文时，AI 生成 query 只能停留在 demo 级硬编码。

#### DatasourceContext 来源边界

为避免 AI 直接接触不受控 schema，MVP 先冻结下面的来源边界：

- 当前唯一支持的运行时 SQL 方言是 `postgres`
- 当前真实查询数据库选型冻结为 `PostgreSQL`
- `DatasourceContext` 的真相源是服务端维护的 datasource metadata snapshot
- metadata snapshot 可以来自人工维护配置、离线同步，或受控的数据库探测
- 浏览器和 AI 不直接读取 PostgreSQL system catalog，也不直接连接数据库
- 前端和 AI 只能拿到服务端裁剪后的可见子集；`visibility_scope` 是唯一允许范围
- `DatasourceContext` 的生成、更新、脱敏和下发由服务端负责，前端只消费，不写入
- 当 `DatasourceContext` 缺失、过期或未通过服务端校验时，系统必须禁用 AI query / binding 生成

在 Agent 侧，建议把 `DatasourceContext` 只通过工具暴露，例如：

- `inspect_datasource_context`

而不是把整份数据库元信息直接无约束塞进 prompt。

## 4. QueryDef

### 4.1 作用

`QueryDef` 用来描述一次可复用的数据查询定义。

它回答的问题是：

- 从哪个数据源取数
- SQL 模板是什么
- 需要哪些参数
- 输出什么形状

### 4.2 建议结构

```json
{
  "id": "q_sales_trend",
  "name": "销售趋势",
  "datasource_id": "ds_sales",
  "sql_template": "select week, sum(gmv) as gmv from sales where order_date >= {{start_date}} and order_date < {{end_date}} group by week order by week asc",
  "params": [
    { "name": "start_date", "type": "date", "required": true, "cardinality": "scalar" },
    { "name": "end_date", "type": "date", "required": true, "cardinality": "scalar" }
  ],
  "output": {
    "kind": "rows",
    "schema": [
      { "name": "week", "type": "string", "nullable": false },
      { "name": "gmv", "type": "number", "nullable": false }
    ]
  }
}
```

### 4.3 字段说明

#### id

query 唯一标识。

#### name

query 的人类可读名称。

#### datasource_id

标记该 query 运行在哪个数据源上。

#### sql_template

命名参数 SQL 模板。

MVP 要求：

- 模板中应明确参数占位符
- 占位符必须与 `params[].name` 一致
- 不允许未声明参数直接出现在模板中
- 模板占位符只用于命名参数声明，不允许直接字符串替换执行

#### SQL 模板执行语义

MVP 中必须明确：

- `sql_template` 不是字符串拼接协议
- 后端必须先解析 `{{param_name}}`
- 后端必须将其编译为对应驱动的 prepared statement 占位符
- 实际执行必须使用“编译后的 SQL + 绑定参数”

不允许做下面这种执行方式：

- 直接用字符串替换把值拼进 SQL

必须采用下面这种执行方式：

1. 解析模板占位符
2. 生成驱动适配后的 SQL，例如 `$1` 或 `?`
3. 将参数值作为 bound values 传给数据库驱动

这样可以把下面这些问题留在受控层解决：

- 日期和字符串的类型处理
- 数组参数展开方式
- 不同数据库驱动的占位符差异
- SQL 注入风险

#### SQL 模板最小安全边界

MVP 阶段建议明确以下执行边界：

- 只允许单条查询语句
- 只允许只读查询，例如 `SELECT` 或 `CTE + SELECT`
- 不允许 `INSERT / UPDATE / DELETE / MERGE`
- 不允许 `CREATE / ALTER / DROP / TRUNCATE`
- 不允许事务和会话控制语句
- 不允许多语句拼接执行

这些边界是 AI 生成 SQL 能否接真实数据源的前提，而不是后续优化项。

#### params

定义 query 可接受的参数列表。

建议字段：

- `name`
- `type`
- `required`
- `default_value`
- `cardinality`

MVP 建议优先支持参数类型：

- `string`
- `number`
- `boolean`
- `date`
- `datetime`

MVP 建议优先支持参数基数：

- `scalar`
- `array`

规则建议：

- 未声明时默认按 `scalar` 处理
- 需要数组语义时必须显式声明 `cardinality: "array"`
- 数组如何编译为最终驱动占位符由后端驱动层负责

#### 参数解析优先级

MVP 中建议统一采用下面的参数解析顺序：

1. 优先使用 `Binding.param_mapping` 解析得到的值
2. 如果没有解析到值，再回退到 `QueryDef.params[].default_value`
3. 如果最终仍无值，则返回参数缺失错误

额外规则：

- 所有出现在 `sql_template` 中的参数，在执行前都必须得到最终值
- `required=false` 不应绕过模板参数缺失校验
- `default_value` 是回退值，不是覆盖 `param_mapping` 的更高优先级值

#### output

定义 query 运行后的输出形状。

建议结构：

```json
{
  "output": {
    "kind": "rows",
    "schema": [
      { "name": "week", "type": "string", "nullable": false },
      { "name": "gmv", "type": "number", "nullable": false }
    ]
  }
}
```

当前建议支持：

- `rows`
- `array`
- `object`
- `scalar`

其中：

- `rows` 适合 `dataset.source`
- `array` 适合 `series[n].data`、`legend.data`、`series[n].links`
- `object` 适合嵌套配置或结构化 payload
- `scalar` 适合单值卡片或阈值

对 `rows` 来说，仍然需要 `schema`。

这是 binding 校验和 preview 校验的重要依据。

## 5. Binding

### 5.1 作用

`Binding` 用于将 `view` 的某个 `slot` 和 `query` 显式连接起来。

它回答的问题是：

- view 的哪个 slot 用哪条 query
- query 参数从哪里来
- query 输出如何供 renderer slot 使用

### 5.2 建议结构

```json
{
  "id": "b_sales_trend",
  "view_id": "v_sales_trend",
  "slot_id": "main",
  "query_id": "q_sales_trend",
  "param_mapping": {
    "start_date": {
      "source": "filter",
      "value": "f_time_range.start"
    },
    "end_date": {
      "source": "filter",
      "value": "f_time_range.end"
    }
  },
  "result_selector": null
}
```

### 5.3 字段说明

#### id

binding 唯一标识。

#### view_id

要绑定的目标 view。

必须引用 `DashboardSpec.views[].id`。

#### query_id

要绑定的 query。

必须引用某个 `QueryDef.id`。

#### slot_id

要填充的目标 slot。

必须引用 `DashboardSpec.views[].renderer.slots[].id`。

#### param_mapping

定义 query 参数如何获得值。

MVP 推荐支持三类来源：

- `filter`
- `constant`
- `runtime_context`

当 `source = filter` 时，`value` 指向的是 filter 的 resolved output，而不是原始 preset 值。

示例：

```json
{
  "start_date": {
    "source": "filter",
    "value": "f_time_range.start"
  },
  "end_date": {
    "source": "filter",
    "value": "f_time_range.end"
  },
  "locale": {
    "source": "runtime_context",
    "value": "locale"
  }
}
```

#### result_selector

定义如何从 query output 中选取最终写入 slot 的值。

设计原则：

- 如果 `QueryDef.output.kind` 与 slot 的 `value_kind` 已直接兼容，`result_selector` 可以为空
- 如果 query 返回的是对象或更复杂结构，`result_selector` 可以声明选择路径
- 协议层优先保持显式，不依赖 renderer 自己猜数据入口

示例：

```json
{
  "result_selector": "data.nodes"
}
```

### 5.4 Stable Binding Cardinality

稳定协议冻结为下面的规则：

- 一个 view 可以声明多个 slot
- 一个 slot 最多只能有一个 binding
- 一个 view 可以同时拥有多个 bindings，只要它们指向不同 slot

也就是说，当前版本的基数是：

- view: `0..n bindings`
- slot: `0..1 binding`

发布前，所有 required slot 应补齐为可执行 binding。

## 6. 参数来源约定

MVP 推荐先统一参数来源约定。

### 6.1 filter

从 Dashboard 级 filter 中取值。

这里取的是 filter 经过统一 resolver 后的结果字段。

示例：

```json
{
  "source": "filter",
  "value": "f_time_range.start"
}
```

这意味着：

- `f_time_range` 的原始值可以仍是 `last_12_weeks`
- 但 binding 使用的是解析后的 `start / end / timezone`

### 6.2 constant

使用固定值。

示例：

```json
{
  "source": "constant",
  "value": "CNY"
}
```

### 6.3 runtime_context

从运行时环境注入。

MVP 仅保留非敏感上下文，例如：

- `timezone`
- `locale`

当前允许键冻结为：

- `timezone`
- `locale`

示例：

```json
{
  "source": "runtime_context",
  "value": "timezone"
}
```

这里必须再明确一条安全边界：

- `runtime_context` 指的是后端最终生效的 `effective_runtime_context`
- 前端请求体中允许传入的只应是客户端 hint，例如 `timezone`、`locale`
- `tenant_id`、`current_user_id`、权限 scope 等字段不在 MVP 范围内
- binding 使用 `source = runtime_context` 时，读取的是后端合成后的最终值

## 7. 预览阶段执行流程

在 Authoring Flow 中，预览数据链路建议按下面顺序执行：

1. 读取 `DashboardSpec`
2. 找到当前 view 声明的目标 `slot`
3. 找到该 `slot` 对应的 `Binding`
4. 根据 `Binding.query_id` 找到 `QueryDef`
5. 先将 raw filter values 解析为 resolved filter outputs
6. 根据 `param_mapping` 组装 query 参数
7. 将 `sql_template` 编译为 prepared statement
8. 执行 query
9. 用 `QueryDef.output` 校验结果结构
10. 如有需要，用 `result_selector` 选出最终写入 slot 的值
11. 将结果写入 `binding_results[binding_id].data`
12. 前端或服务端 renderer 按 slot.path 注入 renderer template

## 8. 运行时读取流程

Viewer Flow 中建议按同样的数据路径执行，只是去掉编辑相关逻辑：

1. 读取已保存的 `DashboardSpec`
2. 读取 `query_defs`
3. 读取 `bindings`
4. 先将当前 filter values 解析为 resolved filter outputs
5. 对每个 required slot 执行绑定查询
6. 后端按 `QueryDef.output` 校验和组装 binding result
7. renderer 按 slot.path 注入数据并渲染

## 9. 示例

下面给出一组可配合 `DashboardSpec` 使用的示例。

### 9.1 QueryDef 示例

```json
[
  {
    "id": "q_sales_trend",
    "name": "销售趋势",
    "datasource_id": "ds_sales",
    "sql_template": "select week, sum(gmv) as gmv from sales where order_date >= {{start_date}} and order_date < {{end_date}} group by week order by week asc",
    "params": [
      { "name": "start_date", "type": "date", "required": true, "cardinality": "scalar" },
      { "name": "end_date", "type": "date", "required": true, "cardinality": "scalar" }
    ],
    "output": {
      "kind": "rows",
      "schema": [
        { "name": "week", "type": "string", "nullable": false },
        { "name": "gmv", "type": "number", "nullable": false }
      ]
    }
  }
]
```

### 9.2 Binding 示例

```json
[
  {
    "id": "b_sales_trend",
    "view_id": "v_sales_trend",
    "slot_id": "main",
    "query_id": "q_sales_trend",
    "param_mapping": {
      "start_date": {
        "source": "filter",
        "value": "f_time_range.start"
      },
      "end_date": {
        "source": "filter",
        "value": "f_time_range.end"
      }
    },
    "result_selector": null
  }
]
```

## 10. 校验规则

MVP 阶段建议至少校验以下规则：

- `QueryDef.id` 唯一
- `Binding.id` 唯一
- `Binding.view_id` 必须存在
- `Binding.slot_id` 必须存在
- `Binding.slot_id` 必须引用目标 view 已声明的 slot
- 同一个 `view_id + slot_id` 在同一 Dashboard 内最多出现一次
- `Binding.query_id` 必须存在
- `sql_template` 中使用的参数必须全部在 `params` 中声明
- `param_mapping` 中出现的参数必须在 `QueryDef.params` 中声明
- `QueryDef.params.required=true` 的参数必须在 `param_mapping` 中有定义，或显式声明 `default_value`
- `QueryDef.output.kind` 必须与 slot 的 `value_kind` 兼容
- `source = filter` 的 `value` 必须引用已定义 filter 的 resolved field
- `source = runtime_context` 的 `value` 必须是允许的非敏感上下文键，目前只允许 `timezone`、`locale`

## 11. 非目标

当前版本暂不覆盖：

- 跨 query join 编排协议
- 多步数据管道协议
- materialized view 管理
- SQL 优化建议协议
- 权限和审计的完整模型
- 多人协作编辑冲突处理

## 12. 后续演进方向

后续可以考虑扩展：

- `query_kind`
- `cache_policy`
- `timeout_ms`
- `retry_policy`
- `post_processors`

但这些都不应阻塞协议稳定化。
