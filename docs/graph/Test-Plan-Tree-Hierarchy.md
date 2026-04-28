# 层级树测试计划

> **目的**：验证 Canvas Spec §6 B4.1 → B4.6 在"层级树"ViewMode 下完整工作
> **范围**：layout 参数、选中、节点编辑、凝结、引用展开、库管理 全链路
> **测试样例**：[Tree-Minimal.md](./samples/Tree-Minimal.md)（7 节点 / 6 边的简单树）+ [KRIG-Note-Concept.md](./samples/KRIG-Note-Concept.md)（复杂树）
> **测试方式**：人工手测，按章节顺序执行
> **使用方法**：勾选每条 ✓（通过）/ ✗（失败，记录现象）/ ⚠️（部分工作）

---

## §0 准备

- [ ] `npm run dev` 启动应用
- [ ] 导入 [Tree-Minimal.md](./samples/Tree-Minimal.md) 为测试图谱（命名"测试-层级树"）
- [ ] 切到"层级树"ViewMode（顶部右边按钮）

---

## §1 自动布局基线（B3.4 + B4.1 默认值）

### §1.1 第一次打开应该是这样

- [ ] 7 个节点：Root + ChildA + ChildB + Leaf1-4
- [ ] **方向 DOWN** — Root 在顶部，Leaf 在底部
- [ ] 边为 **斜直线**（mrtree 的默认）
- [ ] 全部节点可见，无超出画布
- [ ] 没有报错（控制台无红色 error）

### §1.2 切换 ViewMode 不应该破坏

- [ ] 点"力导图"→ 节点散开成力导布局
- [ ] 点"层级树"→ 回到原树形（节点位置可能略有差异，但结构正确）
- [ ] 点"网格"→ 等距网格排布
- [ ] 来回切换不报错

---

## §2 画板 Tab（B4.1 + B4.2.a）

### §2.1 Inspector 浮窗框架

- [ ] 右侧默认显示 Inspector 浮窗
- [ ] 标题"编辑器" + 顶部 4 个 Tab：画板 / 节点 / 库 / 文字
- [ ] 默认选中"画板"Tab
- [ ] 点 › 折叠按钮 → 浮窗收起为右侧细边条
- [ ] 点细边条 → 重新展开

### §2.2 方向切换（必须是层级树 viewMode 下显示）

- [ ] 当前 viewMode 是层级树时，画板 Tab 显示"方向"4 个按钮（⬇⬆⬅➡）
- [ ] 当前选中的方向按钮高亮（蓝色背景）
- [ ] 点 ⬅ → 树立刻重排为左→右（Root 在左）
- [ ] 点 ➡ → 右→左
- [ ] 点 ⬆ → 底→顶
- [ ] 点 ⬇ → 恢复顶→底（默认）
- [ ] 关闭应用重启 → 方向保留（atom 持久化）

### §2.3 边样式切换（v1 全 4 个）

- [ ] 默认 "直线"高亮（mrtree 算法画斜直线）
- [ ] 点"直角" → 边变成直角折线（layered 算法接管）+ 节点位置可能略变
- [ ] 点"折线" → 多段折线
- [ ] 点"曲线" → 平滑曲线
- [ ] 点"直线" → 切回 mrtree
- [ ] 切换边样式时**节点 pinned 位置保留**（layout family 共享）

### §2.4 节点间距 / 层间距

- [ ] 节点间距 4 个预设按钮（紧/中/松/宽）
- [ ] 当前生效预设按钮高亮
- [ ] 点"宽" → 节点之间空间增大
- [ ] 点"紧" → 节点更挤
- [ ] 自定义数字框输入 200 + Enter → 应用更大间距
- [ ] 输入非数字（如 abc）+ Enter → 自动恢复原值
- [ ] 层间距数字框同样工作（仅 tree 类显示）

### §2.5 切到非 tree viewMode 时画板 Tab 显示

- [ ] 切到"力导图" → 画板 Tab 仅显示"节点间距" + 提示"切到层级树以编辑其他参数"
- [ ] 切回"层级树" → 4 组控件全部回来

---

## §3 选中机制（B4.2.a 第 2 步）

### §3.1 单击节点

- [ ] 左键点击 Leaf1 → Leaf1 高亮（fill 变绿色）
- [ ] 左下角 hint 显示 "已选 1"
- [ ] 节点 Tab badge 显示 1
- [ ] 点击空白 → Leaf1 取消高亮

### §3.2 拖动节点

- [ ] 按住 Leaf1 + 拖动（>3px）→ 节点跟随鼠标移动
- [ ] 松开 → 节点固定在新位置（pinned）
- [ ] 重新打开图谱 → Leaf1 还在新位置
- [ ] 切到力导图 ViewMode → Leaf1 位置保留（layout_id='*' 通用）— **预期但需确认**

### §3.3 单击节点（短距移动）vs 拖动

- [ ] 在节点上 mousedown + 微小移动（<3px）+ mouseup → **算单击选中**，不算拖动
- [ ] 节点不应被位移到 0,0

### §3.4 多选

- [ ] 点 Leaf1（选中）
- [ ] **Shift + 点击** Leaf2 → 两个都选中（hint 显示 "已选 2"）
- [ ] **Cmd + 点击** Leaf2（再次）→ Leaf2 取消选中（toggle）
- [ ] **Ctrl + 点击** 同 Cmd（mac/win 兼容）

### §3.5 框选

- [ ] 在画布空白处 mousedown + 拖动（>3px）→ 出现蓝色虚线矩形
- [ ] 框选过程中虚线矩形跟随鼠标
- [ ] 释放 → 框内节点全部选中
- [ ] **Shift + 拖框** → 框内节点加入到当前选中集（不替换）

### §3.6 平移

- [ ] 空白处直接拖动 = **框选**（**不再是平移**！）
- [ ] **空格 + 左键拖** → 平移画布
- [ ] **中键拖** → 平移
- [ ] **右键拖** → 平移
- [ ] **滚轮** → 缩放（以鼠标位置为锚点）

### §3.7 Esc 清空

- [ ] 选中任意节点 → 按 Esc → 取消所有选中

---

## §4 节点 Tab — 单选（B4.2.b）

### §4.1 选 1 个节点后界面

- [ ] 点击 Leaf1 → Inspector 自动切到"节点"Tab
- [ ] 顶部显示 NODE id（截断显示）
- [ ] 蓝色"⬢ 凝结为 Substance"按钮
- [ ] 6 个分组：Substance / Layout / Fill / Stroke / Shape / Label

### §4.2 Substance 替换

- [ ] Substance 区显示当前 substance label（如"抽象概念"）
- [ ] 点击下拉 → 弹出 popover
- [ ] popover 顶部有搜索框
- [ ] 列表按 origin 分组：系统基类 / 内置领域 / 我的 substance（如已凝结过）
- [ ] 当前 substance 项有 ✓ 标记
- [ ] 输入搜索词 "shell" → 列表过滤
- [ ] 点击 "Shell 组件" → 节点 substance 替换 + 视觉变化（颜色 + 形状变 rounded-rect）+ popover 关闭

### §4.3 视觉编辑

测试每个字段：

**Layout**:
- [ ] W 字段输入 100 + Enter → 节点变宽
- [ ] H 字段输入 60 + Enter → 节点变高
- [ ] 修改后字段右侧出现 ↺ 重置按钮
- [ ] 点 ↺ → 字段恢复 substance 默认值，按钮消失

**Fill**:
- [ ] 点 Color 色块 → 浏览器原生颜色选择器弹出
- [ ] 选红色 → 节点填充立即变红
- [ ] Hex 输入框输入 `#00ff00` + Enter → 节点变绿
- [ ] 输入非法值（如 `xyz`）+ blur → 恢复原值
- [ ] Opacity 输入 0.5（或 50）+ Enter → 半透明

**Stroke**:
- [ ] Color 改深蓝
- [ ] Width 改 5 → 边框变粗
- [ ] Style 切到"虚线" → 边框变虚线

**Shape**:
- [ ] 切到"方" → 节点变 rounded-rect
- [ ] 切到"六边" → 节点变六边形
- [ ] 切回"圆"

**Label**:
- [ ] 位置切到"内部" → label 跑到节点中心
- [ ] 位置切到"右侧" → label 在节点右边
- [ ] Color 改成黄色 → label 文字变黄
- [ ] Size 改 18 + Enter → label 字号变大

### §4.4 重置全部 override

- [ ] 改了几个字段都有 ↺ 标记
- [ ] 逐个点 ↺ → 字段恢复 substance 默认 + 标记消失
- [ ] 节点视觉完全恢复初始

---

## §5 节点 Tab — 多选（B4.2.b 第 4 步）

### §5.1 选两个值相同的节点

- [ ] Shift 点击 Leaf1 + Leaf2（substance 都是默认 krig-concept）
- [ ] 节点 Tab 顶部显示 "已选 2 个节点"
- [ ] Substance 字段显示共有值（"抽象概念"）
- [ ] Layout/Fill/Stroke/Shape/Label 全部字段显示共有值

### §5.2 选两个值不同的节点

- [ ] Shift 点击 Leaf1（默认）+ ChildA（默认）
- [ ] 改 ChildA 的 fill.color = 红色（先单选 ChildA 改）
- [ ] 重新选 Leaf1 + ChildA（Shift）
- [ ] Fill Color 字段显示 "Mixed"（Hex 文本框灰色）
- [ ] 其他字段显示共有值（如形状一致 → 显示 "圆"）

### §5.3 多选批量修改

- [ ] 选 Leaf1 + Leaf2 + Leaf3
- [ ] Fill Color 改紫色 → 三个节点同时变紫
- [ ] Shape 切到"方" → 三个节点同时变方
- [ ] 点重置（任意 ↺）→ 三个节点同时恢复

### §5.4 多选时 substance 替换

- [ ] 选 3 个节点
- [ ] Substance 切换到 "Shell 组件"（普通 substance）
- [ ] 三个节点同时替换 substance

---

## §6 边选中（B4.2.b 第 5 步）

### §6.1 选边

- [ ] 鼠标移到 Root → ChildA 的边上（直接点击边的中段）
- [ ] 边被选中（颜色高亮）
- [ ] 节点 Tab 显示 "已选 1 个" 但内容是边专属字段（Color/Width/Style + Substance）
- [ ] 不显示节点专属的 Layout / Fill / Shape / Label

### §6.2 边视觉编辑

- [ ] 改 Color → 边颜色变化
- [ ] 改 Width → 边粗细变化
- [ ] 切 Style → 实/虚/点线切换

### §6.3 混选点 + 边

- [ ] 点节点 Leaf1
- [ ] Shift + 点击一条边
- [ ] 节点 Tab 显示 "已选 N 个元素（混合类型）请仅选择节点或仅选择边"

---

## §7 凝结（B4.3）

### §7.1 单节点凝结

- [ ] 选 Leaf1（改了一些视觉，如 fill 红色 + shape 方）
- [ ] 点"⬢ 凝结为 Substance" 按钮
- [ ] 画布底部出现蓝色 toast "已凝结为「未命名 Substance 1」"
- [ ] Toast 3-4 秒后自动消失
- [ ] 切到库 Tab → 看到 "未命名 Substance 1"

### §7.2 多节点凝结

- [ ] 选 ChildA + Leaf1 + Leaf2（一个子树）
- [ ] 点 ⬢ → toast "已凝结为「未命名 Substance 2」"
- [ ] 库 Tab 看到 N+1 个 substance

### §7.3 持久化

- [ ] **关闭应用 + 重启**
- [ ] 打开同一图谱 → 库 Tab 还能看到刚凝结的 substance
- [ ] 选任意节点 → SubstancePicker "我的 substance" 分组有它们

---

## §8 引用展开（B4.4）

### §8.1 引用普通 substance（无 snapshot）

- [ ] 选 Leaf3 → 替换 substance 为 "Shell 组件"
- [ ] **仅替换引用**：Leaf3 视觉变化，没有新增节点
- [ ] toast 不显示（普通替换不弹）

### §8.2 引用 user substance（含 snapshot，单节点 snapshot）

- [ ] 选 Leaf3 → 替换 substance 为 "未命名 Substance 1"（§7.1 凝结的，含 1 个 geometry）
- [ ] Leaf3 应用 snapshot 第一项的 substance + visual_overrides（fill 红色 + shape 方）
- [ ] 不新建节点（snapshot 只有 1 个，第一项 = anchor，无其他项）

### §8.3 引用 user substance（含 snapshot，多节点 snapshot）

- [ ] 选 Leaf4 → 替换 substance 为 "未命名 Substance 2"（§7.2 凝结的，含 3 个 geometry）
- [ ] Leaf4 应用 snapshot[0] 的样式（ChildA 的样式）
- [ ] **新增 2 个节点**（Leaf1 / Leaf2 的副本）出现在 Leaf4 周围（按相对位置）
- [ ] 新增节点 pinned（不会被自动布局挪走）
- [ ] toast 显示 "已展开「未命名 Substance 2」(3 项)"

### §8.4 多选时引用 user substance

- [ ] 选 Leaf1 + Leaf2（多选）→ 替换 substance 为 "未命名 Substance 2"
- [ ] **不展开**（只替换引用）
- [ ] toast 显示 "多选时仅替换引用，未展开 canvas_snapshot"

---

## §9 库 Tab（B4.5）

### §9.1 列表显示

- [ ] 库 Tab 显示 "共 N 个"
- [ ] 每个 substance 项：label / 几何体数量 / 短 id
- [ ] 含 snapshot 的项前显示 ▸

### §9.2 重命名

- [ ] **双击 label** → label 变成输入框（自动聚焦）
- [ ] 输入新名 + Enter → 名字更新
- [ ] 双击 + Esc → 取消编辑，恢复原名
- [ ] 重命名后切到节点 Tab 的 SubstancePicker → 列表里看到新名

### §9.3 删除

- [ ] 鼠标悬停项 → 右侧出现红色 ✕ 按钮
- [ ] 点 ✕ → 浏览器 confirm 对话框 "删除「xxx」？此操作不可恢复。"
- [ ] 取消 → 不删
- [ ] 确认 → 列表删除该项 + toast 显示 "已删除"
- [ ] 节点 Tab SubstancePicker 不再显示该 substance

### §9.4 删除被引用的 substance

- [ ] 凝结一个 substance → 把某节点引用这个 substance（B4.4 展开过）
- [ ] 在库 Tab 删除这个 substance
- [ ] **预期**：之前展开过的节点视觉**不变**（因为展开时已复制为独立 atom，不依赖 substance 存在）
- [ ] 但如果有节点直接引用此 substance（未展开过，仅替换引用），节点变成 substance unknown 兜底视觉

---

## §10 编辑 snapshot（B4.6）

### §10.1 展开 snapshot 详情

- [ ] 库 Tab 含 snapshot 的项前 ▸ → 点击 → 变 ▾ + 下方 inline 显示 snapshot 详情
- [ ] 显示几何体列表（每项：icon + label/substance + 元信息）
- [ ] 底部显示 layout_id / params 数量

### §10.2 删除 snapshot 中的几何体

- [ ] 鼠标悬停几何体行 → 右侧出现 ✕
- [ ] 点 ✕ → confirm 对话框
- [ ] 确认 → 该几何体从 snapshot 中删除（snapshot 总数 -1）
- [ ] 之前用此 substance 展开过的节点**不受影响**
- [ ] 之后再用此 substance 引用 → 展开时少一个几何体

### §10.3 保留至少 1 个几何体

- [ ] 一直删到剩 1 个几何体
- [ ] 再点 ✕ → 弹出 alert "至少要保留 1 个几何体"
- [ ] 不删除

### §10.4 重启持久化

- [ ] 关闭应用 + 重启
- [ ] 库 Tab → snapshot 内容还是删除后的状态（DB 持久化）

---

## §11 综合场景（端到端）

模拟真实使用流程，验证所有功能协作：

### §11.1 红楼梦人物谱场景

- [ ] 导入 Tree-Minimal.md
- [ ] 切到层级树 → 方向改 LEFT → 边样式改"直角"
- [ ] 改 Root 节点：substance="Shell 组件"，fill 改深蓝
- [ ] 选中所有 Leaf（Shift 多选）→ shape 改"方"
- [ ] 选 Root 节点 → 凝结为 substance "我的根节点风格"
- [ ] 重命名为 "贾母风格"
- [ ] 在另一个图谱新建节点 → substance 选 "贾母风格" → 应用成功
- [ ] 全程无报错

### §11.2 复杂图谱

- [ ] 导入 KRIG-Note-Concept.md（13 节点 + 多关系）
- [ ] 层级树视图能看到 Application → Window → Shell → ... 层级
- [ ] 切边样式 4 次（直/角/折/曲）都能渲染
- [ ] 选中底层叶节点 → 拖到上方 → 释放 → 位置保留
- [ ] 选中底层 5 个孤立节点（force 视图下散在外的）→ 凝结
- [ ] 检查库 Tab snapshot 几何体数 = 5

---

## §12 应该没问题但建议测的边界

- [ ] 没选中节点时点"⬢ 凝结" → 静默无操作（预期）
- [ ] 凝结后立刻删除 → 不会留残留 atom
- [ ] 同一个 user substance 名重复凝结（不同内容）→ 创建两条记录（id 不同）
- [ ] 拖动节点的同时 Inspector 还在打开 → 不卡顿
- [ ] 切换图谱 → Inspector 重置（选中清空、库 Tab 重新拉数据）

---

## §13 已知 v1 限制（不算 bug）

| 项 | 说明 |
|---|---|
| 边没视觉抛光 | 直线/直角/折线/曲线视觉差异不大 — Visual-Polish-Plan 阶段 2 修 |
| label 可能被边穿过 | 同上 — Visual-Polish-Plan 阶段 3 修 |
| 节点+label 不一体 | 同上 |
| 配色"算法画的"感 | Visual-Polish-Plan 阶段 4 修 |
| 多根树挤一团（KRIG-Note-Concept）| Visual-Polish-Plan 阶段 5 修（智能对齐 + 折叠）|
| 文字 Tab 占位 | B4.2.c 推后 v1.5+ |
| 边的箭头/复杂视觉编辑缺失 | v1.5+ |

---

## §14 测试结果记录

| 章节 | 通过率 | 关键问题 |
|---|---|---|
| §1 自动布局基线 | / | |
| §2 画板 Tab | / | |
| §3 选中机制 | / | |
| §4 节点 Tab 单选 | / | |
| §5 节点 Tab 多选 | / | |
| §6 边选中 | / | |
| §7 凝结 | / | |
| §8 引用展开 | / | |
| §9 库 Tab | / | |
| §10 编辑 snapshot | / | |
| §11 综合场景 | / | |
| §12 边界 | / | |

**关键问题清单**（测出问题汇总到这里）：

- [ ] 问题 1：
- [ ] 问题 2：

---

**测试方式建议**：

1. 一次会话只测 1-2 章节，避免疲劳出错
2. 发现 bug 立即记录现象（截图 + 复现步骤）
3. 全部测完后告诉我"§N 失败：xxx"，我集中修一轮
4. 通过的章节直接打 ✓，下次不再测

**测出 bug 后**：
- 修复阶段我会问你 "先修 bug 还是先做视觉抛光阶段 1 审计"
- 我建议**先修关键 bug**（影响功能），再做视觉
