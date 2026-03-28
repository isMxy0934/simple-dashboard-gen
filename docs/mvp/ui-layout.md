# UI Layout v0.2

## 1. 文档定位

本文档定义 MVP 阶段的 Authoring 和 Viewer 页面布局。

目标：

- 明确 Authoring 是 Agent 驱动，不是人工分阶段表单
- 明确 Viewer 是纯生产阅读页，不混入开发信息
- 明确人工介入只保留必要场景

本文档不是视觉稿，只描述结构和交互边界。

## 2. Authoring UI

Authoring 采用两栏工作台：

- 顶部操作栏
- 左侧 Dashboard 画布区
- 右侧 Agent 面板

### 2.1 页面线框

```text
+----------------------------------------------------------------------------------+
| Dashboard Name | Desktop/Mobile | Run Check | Save | Open Viewer                |
+----------------------------------------------------------------------------------+
|                      |                                                    |       |
|              Dashboard / Canvas Preview                |   Agent Panel       |
|                                                        |                     |
| +----------------------------------------------------+ | - Chat messages     |
| | View Card                                 Edit     | | - Pending draft     |
| | Review Mode / Adjust Layout Mode                   | | - Validation        |
| +----------------------------------------------------+ | - Prompt input      |
|                                                        | - Send              |
| +----------------------------------------------------+ |                     |
| | View Card                                 Edit     | |                     |
| | Drag / Resize only in Adjust Layout mode           | |                     |
| +----------------------------------------------------+ |                     |
|                                                        |                     |
+----------------------------------------------------------------------------------+
```

### 2.2 顶部操作栏

顶部操作栏包含：

- Dashboard 名称
- 当前断点切换：`Desktop / Mobile`
- `Run Check`
- `Save`
- `Open Viewer`

说明：

- 不暴露 `Layout / Data` 阶段切换
- 不放临时调试按钮
- `Run Check` 和 `Save` 是当前 Authoring 的主动作

### 2.3 右侧 Agent 面板

左侧不是“AI 工具区”，而是主流程入口。

结构：

- 对话消息流
- 当前待应用建议
- 局部 validation issues
- 底部固定输入框
- `Send` 按钮

Agent 面板需要支持三种入口场景：

1. 用户直接描述报表目标
2. 用户直接粘贴 SQL 或数据需求
3. 用户只提供数据源或业务背景，让 Agent 反推布局和数据

说明：

- 不再暴露 `Layout / Data` 手动切换
- Agent 根据当前 Dashboard 状态决定内部推进方向
- 输入框 placeholder 应根据当前状态变化
- `Cmd/Ctrl + Enter` 发送

### 2.4 中间画布区

画布区是页面主角，负责展示当前 Dashboard。

画布有两种模式：

- `Review Mode`
- `Adjust Layout Mode`

`Review Mode` 负责：

- 查看当前 views
- 选中 view
- 查看每张卡的状态
- 不显示拖拽或 resize 手柄

`Adjust Layout Mode` 负责：

- 拖拽 view
- 调整 view 宽高
- 微调 Desktop / Mobile 布局

每个 view 卡片保留统一 badge：

- `Draft`
- `No Binding`
- `Bound`
- `Preview OK`
- `Error`

说明：

- `empty` 不单独占 badge
- `empty` 归为 `Preview OK`
- 卡片上不展示调试坐标

### 2.5 View 编辑入口

固定右侧属性面板不再作为默认结构。

人工介入方式改为：

- 点击某个 view 的 `Edit`
- 在画布内打开该 view 的编辑抽屉
- 编辑完成后关闭抽屉，回到整体 Dashboard 视角

编辑抽屉中才包含：

- 当前 badge
- 当前 `query_id`
- error 信息
- 标题和描述编辑
- `option_template` 编辑
- query / binding 高级编辑
- validation issues

说明：

- 默认不展开任何重型属性区
- 抽屉是按需人工介入
- `Advanced` 仍然是兜底，不是主路径

## 3. 人工介入场景

Authoring 中，人工介入只有两种合法场景：

1. 布局微调
2. Agent 多次失败后的 contract 兜底修正

具体解释：

- 布局微调指拖拽、缩放、断点下的位置修正
- contract 兜底指 query、binding、field_mapping、param_mapping 的手动修正

不应把人工主流程设计成：

- 手动切换阶段
- 手动填写整套 query/binding 表单
- 手动驱动每一步工作流

## 4. Authoring 关键状态

### 4.1 View 状态

- `Draft`
- `No Binding`
- `Bound`
- `Preview OK`
- `Error`

### 4.2 页面状态

- `Unsaved Changes`
- `Saving`
- `Preview Running`
- `Agent Working`

## 5. Viewer UI

Viewer 页面采用纯只读结构：

- 顶部标题区
- 顶部筛选区
- 主内容区

### 5.1 页面线框

```text
+----------------------------------------------------------------------------------+
| Dashboard Title                                           Updated At             |
+----------------------------------------------------------------------------------+
| Time Range | Refresh                                                        |
+----------------------------------------------------------------------------------+
|                                                                                  |
|   +--------------------------------------------+  +---------------------------+  |
|   | ECharts Card                               |  | ECharts Card              |  |
|   +--------------------------------------------+  +---------------------------+  |
|                                                                                  |
|   +-------------------------------------------------------------------------+    |
|   | ECharts Card                                                            |    |
|   +-------------------------------------------------------------------------+    |
|                                                                                  |
+----------------------------------------------------------------------------------+
```

### 5.2 顶部标题区

包含：

- Dashboard 标题
- 简短说明
- 更新时间

### 5.3 顶部筛选区

包含：

- 时间范围
- 刷新按钮

MVP 中保持克制，不堆积过多筛选器。

### 5.4 主内容区

主内容区只负责展示报表。

Viewer 中不应出现：

- AI 对话入口
- 编辑属性
- 调试 KPI 卡
- API 或 runtime 说明文案
- 拖拽手柄
- 坐标和布局调试信息

## 6. 移动端建议

### 6.1 Authoring

- 主要编辑在 Desktop 完成
- Mobile 断点主要用于预览和局部布局微调
- `mobile` 布局默认由系统从 `desktop` 自动生成

### 6.2 Viewer

- 完整支持移动端阅读
- 卡片优先单列堆叠
- 图表在必要时纵向拉长

## 7. 当前统一结论

当前 UI 方向统一如下：

1. Authoring 是 Agent 驱动，人主要负责审核和微调
2. Authoring 不再暴露人工 `Layout / Data` 两阶段切换
3. 中间画布默认是 Review Mode，只有进入 `Adjust Layout` 才允许拖拽
4. 单个 view 的人工编辑通过按需抽屉进入，不再长期占用固定右侧面板
5. Viewer 保持纯生产阅读页，不混入开发和调试信息
