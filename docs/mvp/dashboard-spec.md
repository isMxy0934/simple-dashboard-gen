# DashboardSpec v0.2

## 1. 文档定位

本文档定义 MVP 阶段的 `DashboardSpec`。

`DashboardSpec` 只负责描述 Dashboard 的页面结构和 ECharts 模板，不负责保存 SQL，也不负责保存带真实数据的渲染结果。

它的职责范围是：

- 页面基础信息
- 布局结构
- view 模板定义
- Dashboard 级 filters

它不负责：

- 参数化 SQL 模板
- query 执行逻辑
- view 和 query 的 binding
- 最终运行时渲染结果

## 2. 设计原则

### 2.1 DashboardSpec 是页面语义层

`DashboardSpec` 表达的是“页面要展示什么结构”，而不是“数据如何执行”。

### 2.2 View 是 ECharts Renderer 容器

稳定协议中，每个 `view` 都是一个不带运行时数据的 ECharts renderer 容器。

它描述：

- view 的标识
- 标题和说明
- ECharts `option_template`
- 明确的数据注入槽位 `slots`

它不直接绑定 SQL，不保存最终数据，也不保留语义化 `kind`。

### 2.3 数据由 binding 注入

运行时由后端执行 query，再把 binding 结果注入到 `view.renderer.slots[]` 声明的路径。

这意味着：

- `DashboardSpec` 不保存最终 option
- `DashboardSpec` 不保存图表数据
- `DashboardSpec` 不保存语义化 view 类型
- `DashboardSpec` 必须显式声明 renderer 的 runtime-owned 数据入口

## 3. 顶层结构

`DashboardSpec` 建议包含以下字段：

```json
{
  "schema_version": "0.1",
  "dashboard": {},
  "layout": {},
  "views": [],
  "filters": []
}
```

## 4. 字段定义

### 4.1 schema_version

协议版本号。

建议：

- 使用字符串，例如 `0.1`
- 用于后续 schema 演进
- 不等同于存储层的 Dashboard `version`

这里必须和持久化版本号明确区分：

- `schema_version` 表示 `DashboardSpec` 协议版本
- 存储表中的 `version` 表示某个 Dashboard 的保存版本号

### 4.2 dashboard

保存 Dashboard 的展示元数据。

这里不承担持久化生命周期字段的真相源职责。

MVP 中以下字段应由存储层维护，而不是由 `DashboardSpec` 维护：

- `dashboard_id`
- `version`
- `status`
- `created_at`
- `updated_at`

建议结构：

```json
{
  "name": "销售周报",
  "description": "销售核心指标周报"
}
```

建议字段：

- `name`
- `description`

### 4.3 layout

描述不同断点下的页面布局。

MVP 先建议只做：

- `desktop`
- `mobile`

建议结构：

```json
{
  "desktop": {
    "cols": 12,
    "row_height": 30,
    "items": [
      { "view_id": "v_sales_trend", "x": 0, "y": 0, "w": 12, "h": 8 }
    ]
  },
  "mobile": {
    "cols": 4,
    "row_height": 30,
    "items": [
      { "view_id": "v_sales_trend", "x": 0, "y": 0, "w": 4, "h": 8 }
    ]
  }
}
```

建议规则：

- `layout.items[].view_id` 必须引用已存在的 `views[].id`
- 每个断点下的坐标系统独立维护
- 同一断点下不应重复引用同一 `view_id`
- 某个 breakpoint 是否显示某个 view，只看对应 `layout.items` 中是否包含它

#### Desktop / Mobile 的快速实现规则

为降低 MVP 实现复杂度，当前先冻结下面的规则：

- `desktop` 是 Authoring 中的主编辑布局
- `mobile` 是从 `desktop` 派生出的持久化布局
- 当 `mobile` 缺失时，系统应按 view 顺序自动生成单列堆叠布局
- MVP 中 Authoring 的 `mobile` 视图以预览为主，不要求支持完整拖拽编辑

这样可以保证：

- 协议层已经支持 `desktop + mobile`
- 工程实现可以先用 `desktop` 跑通主编辑链路
- Viewer 仍然可以读取已生成的 `mobile` 布局

### 4.4 views

`views` 是 Dashboard 的核心展示单元。

每个 `view` 都是一个不带数据的 ECharts renderer 容器。

建议结构：

```json
{
  "id": "v_sales_trend",
  "title": "销售趋势",
  "description": "近 12 周 GMV",
  "renderer": {
    "kind": "echarts",
    "option_template": {
      "tooltip": { "trigger": "axis" },
      "legend": {},
      "xAxis": { "type": "category" },
      "yAxis": { "type": "value" },
      "series": [
        {
          "type": "line",
          "smooth": true,
          "encode": {
            "x": "week",
            "y": "gmv"
          }
        }
      ]
    },
    "slots": [
      {
        "id": "main",
        "path": "dataset.source",
        "value_kind": "rows",
        "required": true
      }
    ]
  }
}
```

建议字段：

- `id`
- `title`
- `description`
- `renderer.kind`
- `renderer.option_template`
- `renderer.slots[]`

模板中的数据字段可以通过 ECharts 的 `encode` 表达，也可以通过 `series.data`、`dataset[n].source`、`series.links` 等标准路径表达。协议层不再把 ECharts 收窄成只能使用 `series[].encode + dataset.source` 的子集。

#### Stable Renderer Contract

为了保证协议可校验、运行时可闭环，稳定协议冻结下面的规则：

- `renderer.kind` 当前冻结为 `echarts`
- `renderer.option_template` 可以是合法的 ECharts option 模板
- 协议不再强制所有 series 都必须使用 `encode`
- 协议不再强制所有运行时数据都只能注入 `dataset.source`
- 所有运行时数据入口必须通过 `renderer.slots[]` 显式声明
- 持久化模板中不允许保存真实运行时数据；slot 指向的 runtime-owned path 在持久化时必须为空模板态

#### Renderer Slots

建议结构：

```json
{
  "renderer": {
    "kind": "echarts",
    "option_template": {
      "series": [
        {
          "type": "sankey"
        }
      ]
    },
    "slots": [
      {
        "id": "nodes",
        "path": "series[0].data",
        "value_kind": "array",
        "required": true
      },
      {
        "id": "links",
        "path": "series[0].links",
        "value_kind": "array",
        "required": true
      }
    ]
  }
}
```

设计规则：

- `path` 表示运行时注入位置，例如：
  - `dataset.source`
  - `dataset[0].source`
  - `series[0].data`
  - `series[0].links`
  - `legend.data`
- `value_kind` 表示该 slot 接受的数据形状，当前建议支持：
  - `rows`
  - `array`
  - `object`
  - `scalar`
- 一个 `view` 可以声明多个 slot
- 同一个 `slot` 在有效 contract 中最多只有一个 active binding
- 是否允许发布，不再只看 `encode`，而是看 required slot 是否都被绑定

### 4.5 filters

`filters` 定义 Dashboard 级筛选器。

这些筛选器本身不直接执行 SQL，只定义用户可操作的筛选输入。

建议结构：

```json
[
  {
    "id": "f_time_range",
    "kind": "time_range",
    "label": "时间范围",
    "default_value": "last_12_weeks",
    "resolved_fields": ["start", "end", "timezone"]
  }
]
```

建议字段：

- `id`
- `kind`
- `label`
- `default_value`
- `options`
- `resolved_fields`

MVP 推荐先支持：

- `time_range`
- `single_select`

#### time_range 的执行语义

`time_range` 的 `default_value` 或当前用户选择值可以是预设值，例如：

- `today`
- `this_week`
- `last_12_weeks`

这些值本身不是最终传给 query 的参数。

它们必须先经过一层统一解析，生成 resolved range：

```json
{
  "start": "2026-01-01T00:00:00+08:00",
  "end": "2026-03-26T00:00:00+08:00",
  "timezone": "Asia/Shanghai"
}
```

MVP 规则：

- 前后端应共享同一套 preset 解析规则
- 后端是最终 authoritative resolver
- `binding` 中引用的 `f_time_range.start` / `f_time_range.end` 指向的是 resolved value，不是 preset 原文

时区优先级建议为：

1. `runtime_context.timezone`
2. 系统默认时区

#### single_select 的最小协议

MVP 中 `single_select` 至少应包含：

```json
{
  "id": "f_region",
  "kind": "single_select",
  "label": "区域",
  "value_type": "string",
  "default_value": "华东",
  "options": [
    { "label": "华东", "value": "华东" },
    { "label": "华南", "value": "华南" }
  ]
}
```

规则建议：

- `options` 必须非空
- `default_value` 必须出现在 `options` 中
- `options[].value` 必须符合 `value_type`

## 5. 示例

下面是一个最小可用的 `DashboardSpec` 示例：

```json
{
  "schema_version": "0.1",
  "dashboard": {
    "name": "销售周报",
    "description": "近 12 周销售趋势"
  },
  "layout": {
    "desktop": {
      "cols": 12,
      "row_height": 30,
      "items": [
        { "view_id": "v_sales_trend", "x": 0, "y": 0, "w": 12, "h": 8 }
      ]
    },
    "mobile": {
      "cols": 4,
      "row_height": 30,
      "items": [
        { "view_id": "v_sales_trend", "x": 0, "y": 0, "w": 4, "h": 8 }
      ]
    }
  },
  "views": [
    {
      "id": "v_sales_trend",
      "title": "销售趋势",
      "description": "近 12 周 GMV",
      "renderer": {
        "kind": "echarts",
        "option_template": {
          "tooltip": { "trigger": "axis" },
          "legend": {},
          "xAxis": { "type": "category" },
          "yAxis": { "type": "value" },
          "series": [
            {
              "type": "line",
              "smooth": true,
              "encode": {
                "x": "week",
                "y": "gmv"
              }
            }
          ]
        },
        "slots": [
          {
            "id": "main",
            "path": "dataset.source",
            "value_kind": "rows",
            "required": true
          }
        ]
      }
    }
  ],
  "filters": [
    {
      "id": "f_time_range",
      "kind": "time_range",
      "label": "时间范围",
      "default_value": "last_12_weeks",
      "resolved_fields": ["start", "end", "timezone"]
    }
  ]
}
```

## 6. 校验规则

MVP 阶段建议最少校验以下规则：

- `dashboard.name` 非空
- `views[].id` 唯一
- `views[].renderer.kind` 必须存在且当前为 `echarts`
- `views[].renderer.option_template` 必须存在
- `views[].renderer.slots[]` 中的 `id` 在同一 view 内唯一
- `views[].renderer.slots[]` 中的 `path` 在同一 view 内唯一
- `views[].renderer.option_template` 不应直接保存真实运行时数据；slot 指向的 runtime-owned path 必须保持为空模板态
- `layout.items[].view_id` 必须存在于 `views[].id`
- 同一断点下布局 item 不应重复引用同一 view
- `filters[].id` 在一个 Dashboard 内唯一
- `time_range` filter 若被 query 引用，必须声明 `resolved_fields`
- `single_select.options` 必须非空
- `single_select.default_value` 必须存在于 `options` 中

## 7. 非目标

当前版本的 `DashboardSpec` 暂不覆盖以下能力：

- 语义化 `kind`
- 语义化 `text view`
- 发布版本历史模型
- 复杂联动分析协议
- 权限和行级数据访问策略
- 多人协作编辑冲突处理

## 8. 后续演进方向

后续如果需要扩展，可以考虑新增：

- `interactions`
- `annotations`
- `drilldown`
- `refresh_policy`
- `renderer_hints`

但这些不应阻塞 MVP v0.1 的落地。
