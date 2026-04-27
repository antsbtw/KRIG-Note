---
title: Tree 布局最小测试
graph_variant: knowledge
dimension: 2
active_layout: tree-hierarchy
---

# 测试说明

最小用例：一棵 3 层 contains 树，**只有** contains 关系，没有 routes-to / defines / boundary 等其他边。
用来隔离 tree-hierarchy 布局是否正确。预期：根在上，2 个子在中间，4 个孙在下，整齐居中。

---

# Root [[root]]

> 树根。

- substance :: krig-concept
- type :: concept
- contains :: [[child-a]]
- contains :: [[child-b]]

# ChildA [[child-a]]

> 左子。

- substance :: krig-concept
- type :: concept
- contains :: [[leaf-1]]
- contains :: [[leaf-2]]

# ChildB [[child-b]]

> 右子。

- substance :: krig-concept
- type :: concept
- contains :: [[leaf-3]]
- contains :: [[leaf-4]]

# Leaf1 [[leaf-1]]

- substance :: krig-concept
- type :: concept

# Leaf2 [[leaf-2]]

- substance :: krig-concept
- type :: concept

# Leaf3 [[leaf-3]]

- substance :: krig-concept
- type :: concept

# Leaf4 [[leaf-4]]

- substance :: krig-concept
- type :: concept
