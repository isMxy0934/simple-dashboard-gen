#!/usr/bin/env python3
"""Rewrites docs/mvp/ui-layout.md with the updated agent-first content."""

content = """\
# UI Layout v0.2

## 1. 文档定位

本文档用简单 Markdown 方式描述 MVP 阶段的 UI 布局。

目标：

- 明确 Authoring 页面怎么排
- 明确 Viewer 页面怎么排
- 体现 Agent 驱动的核心交互模型

本文档不是视觉稿，也不是高保真设计稿，只是结构草图。

## 2. Authoring UI

Authoring 页面采用四栏结构：

- 顶部操作栏
- 左侧 Agent 面板（主交互区）
- 中间画布区（结果展示）
- 右侧 Review 面板（审核与兜底）

### 2.1 页面线框

```text
+---------------------------------------------------------------------------------+
| Dashboard Name                     Desktop/Mobile | Preview | Save | Open Viewer|
+---------------------------------------------------------------------------------+
|                      |                                                   |       |
|   Agent Panel        |           Canvas (Review Mode)                   | View  |
|                      |                                                   | Review|
|  Agent:              |  +---------------------------------------------+ |       |
|  Describe your       |  | [Badge] View Title                          | | badge |
|  dashboard...        |  | Chart Preview                               | | chart |
|                      |  +---------------------------------------------+ |       |
|  > User input        |                                                   | ────  |
|                      |  +---------------------------------------------+ | Edit  |
|  Agent: I'll create  |  | [Badge] View Title                          | | (adv) |
|  3 views based on... |  | Chart Preview                               | |       |
|                      |  +---------------------------------------------+ |       |
|  _______________     |           [Adjust Layout] toggle                  |       |
|  | input...    |     |                                                   |       |
|  |_____________|     |                                                   |       |
|  [Send]              |                                                   |       |
+---------------------------------------------------------------------------------+
```

### 2.2 顶部操作栏

顶部操作栏保持精简，只包含：

- Dashboard 名称（可编辑）
- 断点切换：`Desktop / Mobile`
- `Preview`
- `Save`
- `Open Viewer`

原则：

- 顶部只放完成动作，不放编辑工具
- 时间筛选、Region 等预览参数不出现在顶部
- 不暴露内部调试操作（Regenerate Mobile、Reset Local 等）

### 2.3 左侧 Agent 面板

Agent 面板是页面的**主交互区**，采用对话优先设计。

#### 交互模型

Agent 主动发起对话，用户只需回答或给指令，Agent 自行决定下一步。

Agent 的第一条消息根据 Dashboard 当前状态决定：

- Dashboard 为空：引导用户描述场景、提供 SQL 或描述数据源
- Dashboard 已有 views 但无 binding：Agent 主动提示进入数据绑定环节
- Dashboard 已有完整 binding：Agent 主动提示可以预览或发布

#### 三种典型入口

Agent 会根据用户的第一句话判断从哪里切入：

1. **用户提供 SQL**：Agent 分析 SQL 推断 result schema，生成 views + option_template + bindings
2. **用户描述场景**：Agent 生成 views 骨架，查询 datasource schema，生成 SQL，建立 bindings
3. **用户描述数据源**：Agent 与用户讨论数据结构，确认后生成 views + SQL + bindings

三种路径的终点相同：补齐 `DashboardSpec + QueryDef + Binding`。

#### 面板结构

- 顶部：Agent 标识，无阶段切换 toggle
- 中部：对话流（Agent 消息、用户消息、建议卡、错误提示）
- 底部：输入框（固定）+ Send 按钮，支持 Cmd/Ctrl+Enter 发送

#### 不包含

- Layout / Data 阶段手动切换 toggle（Agent 内部管理阶段状态，不暴露给用户）
- Datasource Context 状态卡（内部信息）
- 全局 Validation 列表（错误只在 view badge 和 Review 面板中展示）
"""

with open("docs/mvp/ui-layout.md", "w", encoding="utf-8") as f:
    f.write(content)

print("Part 1 written.")

