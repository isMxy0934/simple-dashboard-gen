# 核心设计契约

## 1. 系统目标

本系统是一个 AI 辅助的 dashboard 创作运行时。

核心目标是：

> 用户通过自然语言和确定性工具创作 dashboard，但从创作到 Viewer 运行时，`DashboardDocument` 始终是唯一事实源。

产品主流程是：

```text
用户意图
-> AI / 工具创作
-> DashboardDocument
-> contract / runtime / renderer 检查
-> 用户确认
-> 保存 / 发布
-> Viewer 渲染
```

系统可以增加数据源、渲染器、skills、协作、部署等扩展能力，但这些扩展不能绕过或削弱核心文档契约。

## 2. 核心内核

产品内核是：

```text
DashboardDocument = DashboardSpec + QueryDefs + Bindings
```

### DashboardSpec

`DashboardSpec` 描述 dashboard 的展示结构：

- dashboard 元信息
- layout
- views
- filters
- renderer templates
- renderer slots

它不能包含：

- runtime rows
- query 执行结果
- datasource secrets
- AI workflow state
- save / publish / session state

### QueryDefs

`QueryDefs` 描述只读数据获取契约：

- `datasource_id`
- `sql_template`
- `params`
- `output`

它不能包含：

- mutation SQL
- UI state
- renderer layout intent
- agent memory
- hidden business workflow state

### Bindings

`Bindings` 描述数据接线关系：

- view slot
- query
- param resolution
- optional result selection
- mock mode 下的 mock data

它不能包含：

- layout intent
- business rules
- datasource credentials
- renderer template state
- agent workflow state

## 3. 不可违背的不变量

一个有效的持久化 dashboard 必须严格等于一个 `DashboardDocument`。

每一个已保存或已发布的文档都必须满足：

- 每个 layout item 都引用一个存在的 view
- 每个 live binding 都引用一个存在的 view slot
- 每个 live binding 都引用一个存在的 query
- 每个 view slot 最多只有一个 active binding
- 每个 mock binding 必须携带 mock rows，且不能同时携带 live query wiring
- 每个 live query 必须是只读查询
- 每个运行时需要的 query param 都能从 filters、constants 或 runtime context 解析出来
- 每个 query result 都必须按照 `QueryDef.output` 校验
- 每个 renderer slot 都能说明 runtime data 注入到哪里
- 删除或替换 view、query、slot、binding 后，不能留下孤儿引用

Validation 不只是防御性代码，它是产品设计的一部分。

如果某条规则影响运行时正确性，它应该被编码到 `contracts/validation.ts`，或被保存 / 发布前调用的确定性 domain/runtime validator 覆盖。

## 4. 生命周期语义

### Authoring

Authoring 可以持有临时 UI state、draft inputs、selected view state、chat state、local interaction state。

但 dashboard 行为必须始终能回到 `DashboardDocument` 解释。

AI 和 UI 可以提出变更，但持久化 dashboard 行为只能通过文档操作改变。

### Preview

Preview 针对 `DashboardDocument` 执行。

Preview 可以接受尚未达到发布标准的 draft，但不能用另一套语义解释文档。

Preview failure 应该是结构化、可恢复的：

- contract failure
- datasource / runtime failure
- renderer failure

### Save

Save 持久化一个有效的 `DashboardDocument`。

Save 可以比 Publish 宽松，但不能保存内部不一致的文档。

Save 不能额外持久化第二套 dashboard 表示来重新定义同一份 dashboard 行为。

### Publish

Publish 是严格运行时边界。

Publish 可以拒绝 Save 允许的文档，尤其是 required slots、live queries、renderer checks 尚未完成时。

Publish 不能改变文档含义。

### Viewer

Viewer 渲染已发布的 `DashboardDocument`。

Viewer 不能依赖 authoring-only state、agent state 或 hidden frontend state 来理解 dashboard 行为。

如果 Viewer 无法渲染，失败原因必须能从以下内容解释：

- document
- runtime input
- datasource / runtime availability
- renderer validation

## 5. 扩展边界

扩展能力只有在挂接到核心契约且不绕过核心契约时才允许存在。

### Datasources

Datasource management 是扩展层。

它可以提供：

- datasource registration
- connection testing
- schema introspection
- query execution

它不能：

- 把 credentials 存进 `DashboardDocument`
- 允许删除 datasource 后留下 unresolved live queries
- 在 `QueryDef` 之外注入隐藏 query 语义
- 让 Preview 和 Viewer 对同一个 query 使用不同解释

### Renderers

Renderers 是扩展层。

ECharts 是当前 renderer contract，但核心不能变成狭窄的 chart-type DSL。

Renderer extensions 必须：

- 暴露显式 template slots
- 校验注入后的 runtime data
- 把 renderer-specific parsing 留在 `src/renderers/`，不要放进 `domain/`

Renderer extensions 不能：

- 把 renderer-specific business rules 放进 `domain/`
- 从视觉 template shape 反推 query 语义
- 依赖 hidden frontend-only state 才能渲染

### AI Skills And Tools

AI 是 authoring surface，不是隐藏事实源。

AI 可以：

- inspect dashboard state
- inspect datasource summaries / schema
- stage document changes
- run checks
- propose patches
- explain failures

AI 不能：

- 在显式 document tools 之外改变持久化 dashboard 行为
- 把 hidden memory 当成 dashboard 语义的一部分
- 创建平行 dashboard model
- 绕过 validation、approval、save 或 publish 规则

### Collaboration And Sessions

Collaboration state 是运行时支撑，不是 dashboard 语义。

Sessions 可以保存：

- presence
- unsaved draft state
- chat memory
- approval state
- selected / focused view

Sessions 不能成为渲染已保存或已发布 dashboard 的必要条件。

## 6. 全新项目的一次性切换策略

在没有生产数据兼容要求时，本项目可以接受一次性 breaking schema reset。

这个策略允许：

- 要求 fresh database
- 丢弃 prototype data
- 用新的 workspace tables 替换旧表

这个策略不允许：

- 在普通 app runtime 中隐藏执行 destructive drops
- app startup 意外删除数据
- reset 行为不清晰

Destructive reset 应该放在显式 setup / reset scripts，或写清楚的 Docker initialization 步骤里，而不是放在普通 request-time schema bootstrap 中。

## 7. 失败模型

失败应该显式且局部化。

扩展层可以失败，但不能破坏核心文档：

- datasource connection unavailable
- query execution failed
- renderer validation failed
- AI tool failed
- browser validation unavailable

这些失败应该产出结构化 status，而不是制造无效 document state。

系统在以下情况下应被视为核心损坏：

- 已保存文档无法由 `DashboardDocument` 解释
- Preview 和 Viewer 使用不同语义
- Publish 悄悄改变 dashboard 含义
- 删除扩展对象后留下内部不一致的持久化 dashboard
- AI state 成为解释已保存 dashboard 的必要条件
- runtime 接受了违反 `QueryDef.output` 的 query results

## 8. 合并阻塞规则

如果一个改动造成以下任一情况，应阻塞合并：

- 引入第二套 dashboard representation
- 绕过 `DashboardDocument` 改变持久化行为
- 削弱运行时关键不变量的文档校验
- 让 Preview、Publish、Viewer 对同一字段使用不同解释
- 把 datasource secrets 或 runtime rows 存进 `DashboardSpec`
- 留下孤儿 views、layout items、queries、bindings、slots 或 datasource references
- 把 destructive persistence behavior 放进普通 app runtime
- 新增无法局部失败的扩展能力

## 9. 设计测试

任何新功能进入核心前，都要回答：

1. 哪一部分 `DashboardDocument` 解释了它的运行时行为？
2. 哪条 validation rule 防止无效状态被持久化？
3. Preview 和 Viewer 对它的语义是否一致？
4. 这个功能失败时，能否不破坏 document？
5. 这是持久化 dashboard 行为，还是临时 UI / session state？

如果这些问题不能清楚回答，这个功能就还不适合进入 core。
