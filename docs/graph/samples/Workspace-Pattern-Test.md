---
title: Workspace Pattern 试金石
graph_variant: knowledge
dimension: 2
active_layout: force
---

# Pattern Workspace 试金石

最小测试样例，验证 `pattern-workspace` Pattern Substance 的端到端渲染：
- 1 个 workspace 容器（引用 `pattern-workspace`）
- 4 个角色子节点（navside / slot / ipc / toolbar）

预期渲染结果：
- workspace 容器 = 深紫色圆角矩形（400×300）
- navside 在容器**左**侧
- slot 在容器**中**间
- toolbar 在容器**上**边
- ipc 在容器**下**边
- 4 个子节点都在容器**内部**（按相对偏移排）

---

# Workspace [[workspace-1]]

> 测试 pattern-workspace 的容器节点

- substance :: pattern-workspace
- contains :: [[ws-navside]]
- contains :: [[ws-slot]]
- contains :: [[ws-ipc]]
- contains :: [[ws-toolbar]]

# NavSide [[ws-navside]]

> 左侧导航栏（角色：navside）

- substance :: krig-navside

# Slot [[ws-slot]]

> 中间内容槽位（角色：slot）

- substance :: krig-slot

# IPC [[ws-ipc]]

> 跨层通信（角色：ipc，底部）

- substance :: krig-ipc

# Toolbar [[ws-toolbar]]

> 顶部工具栏（角色：toolbar）

- substance :: krig-toolbar
