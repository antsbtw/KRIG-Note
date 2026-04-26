# KRIG · Graph 3D Rendering 实施完成报告

> Implementation Report · 2026-04-26
>
> 对应规范：
> - `docs/graph/KRIG_GraphView_Spec_v1.3.md`（GraphView 主 spec）
> - `docs/graph/Graph-3D-Rendering-Spec.md`（渲染层独立 spec）
> - `docs/graph/Graph-3D-Rendering-PoC-Report.md`（PoC 评审报告，本次实施的输入证据）
>
> 实施分支：`feature/graph-3d-rendering`
> 起止 commit：`15730e29` … `cf1310d2`（共 ~50 个 commit，含 4 次 merge 到 main）

---

## 0. 完成概览

**结论：v1.3 实施完整收尾，进入运行使用 + v1.4 规划阶段。**

按 spec § 11 划分的 4 个 Phase 全部落地：

| Phase | spec 估算 | 实际实施 | 主线 commit 数 | 状态 |
|-------|---------|---------|--------------|------|
| Phase 1 渲染管线切换 | 2 周 | 1 天 | 7 | ✅ 完成 |
| Phase 2 缓存 + 边渲染 | 1 周 | 1 天 | 6 | ✅ 完成 |
| Phase 3 EditOverlay | 1 周 | 1 天 | 15（含 6 fix） | ✅ 完成 |
| Phase 4 性能与稳定性 | 1 周 | 1 天 | 14（含 9 fix） | ✅ 完成（4.3/4.4 跳过） |
| **合计** | **5 周** | **4 天** | **42** | **✅** |

实际工程量远低于 spec 估算（5 周 → 4 天），原因：

1. **PoC 已验证可行性**：风险点（字体 / MathJax / 性能）在 PoC 阶段全部解决，正式实施期接 PoC 路线，无重大返工
2. **形状/内容分离架构稳定**：从 Phase 1 接口落地后未再大改
3. **与用户实时反馈协作**：每步实测 → 发现 bug → 修复 → 验证 → 下一步，无方向性偏差

---

## 1. Phase 1 — 渲染管线切换

**核心任务**：CSS2DRenderer DOM 浮层 → SVG 几何 mesh 进入 Three.js 场景。

**关键决策**：
- v2 数据模型升级（GraphNode.label: string → Atom[]）作为前置 merge 到 main
- nodeMeshes Map<Mesh> → nodeGroups Map<Group>，InteractionController 同步重构
- 字体子集化（GB 2312 一级 + ASCII，8MB → ~1MB）

**性能数据**（实测 vs PoC 基线）：

| 指标 | PoC | Phase 1 | 备注 |
|------|------|---------|------|
| 字体冷加载 | 116ms | 27ms | Inter 84KB / Noto SC 999KB |
| MathJax 初始化 | 3.2ms | 持平 | 不受字体影响 |
| 节点显示 / 编辑 | DOM | SVG 几何 | 视觉接近，无 strut 撑高 |

详见 commit `92a6b9c8` (merge Phase 1 to main)。

---

## 2. Phase 2 — 缓存 + 边渲染优化

**核心任务**：三级缓存（spec § 5）+ EdgeRenderer 类抽象 + 序列化器 P1 Block 类型。

**关键决策**：
- L1 SvgCache（atomsToSvg 入口，LRU 1000）+ L2 GeometryCache（SVG → ShapeGeometry+Material 共享，LRU 500）+ L3 不缓存 Mesh
- 序列化器扩充 mark（bold / italic / underline / code，含 Inter Bold / Italic + JetBrains Mono 字体）
- 序列化器扩充 bulletList / orderedList
- EdgeRenderer 从 GraphEngine 内嵌函数 → 独立类，支持 createEdge / updateLabel / setHighlight / dispose

**Bug 修复**：
- SvgGeometryContent.dispose 在 traverse 中改 children 越界（`62b42048`）
- edgeRedrawToken 改为 per-edge，避免新边导致旧边消失（`3e9ce643`）

详见 commit `2081b151` (merge Phase 2 to main)。

---

## 3. Phase 3 — EditOverlay 编辑模式

**核心任务**：双击节点/边 → 完整 ProseMirror 编辑器浮层。

**关键决策**：
- PM schema 在 graph 模块独立定义（不依赖 Note，按 spec § 1.2 跨视图共享原则）
- 浮层挂到 `document.body` 内的 backdrop（脱离 CSS2DRenderer 事件传递死结）
- slash menu / math popover / inline toolbar 三个辅助 UI 全部 PM Plugin 化
- 编辑提交后 setNodeLabel / setEdgeLabel 走 CommandStack（支持 undo）

**Bug 修复**（Phase 3 阶段实测发现 6 个）：
- popup 挂载位置导致事件传递不可靠（`a3840220`）
- 空段光标不可见（`867cd8f1`）
- slash menu Esc 关闭后立即重新激活（`1af804ba`）
- ∑ 按钮直接格式化选区文字（不弹空 popover）（`66d9857b`）
- 边浮窗指针锚定 + 取曲线中段顶点（`82499634`、`f013ad5b`）

**完整功能清单**：
- mark: bold / italic / underline / code 全套快捷键
- heading: h1-h3 + Mod-Alt-1/2/3
- list: bulletList / orderedList + Tab/Shift-Tab 缩进
- math: mathInline + mathBlock 全 NodeView + KaTeX 实时预览
- inputrules: `# ` / `## ` / `### ` / `- ` / `1. `
- slash menu: 10 项命令，中英双语关键词

详见 commit `f6777c43` (merge Phase 3 to main)。

---

## 4. Phase 4 — 性能与稳定性

**核心任务**：性能监控 + 自适应退化策略。

### 4.1 PerfPanel 性能监控（已完成）

- `protected perfStats: PerfStats` 字段（lastNodeMs / totalNodes / totalSetupMs / fps）
- `font-loader.getFontLoadStats()` + `mathjax-svg.getMathjaxInitMs()` + cache stats 暴露
- PerfPanel React 组件：右下角 ⏱ 按钮 + 三段（render / cache / init）

### 4.2 自适应退化（已完成，超预期实施完整版）

按用户偏好（"自适应配置 + 自动调优"）实施完整 4 层架构：

```
PerfConfig (配置层) - localStorage 持久化
    ↓
AdaptivePolicy (策略层) - 状态机 normal ↔ degraded
    ↑                       ↓
PerfHistory (观测层)    退化动作:
    ↑                    - hoverPaused (fps < fpsLow)
AutoTuner (调优层)       - lodEnabled (nodeCount > lodNodeCount)
- 启动时读历史
- 推荐 thresholds
```

PerfPanel 增加 adapt tab：mode 切换 / thresholds 数字输入 / actions 复选框 / 历史会话表格。

### 4.3 跨平台字体验证（**跳过**）

仅 macOS 实测。Windows / Linux 字体渲染一致性作为已知风险，记入 § 6。

### 4.4 回归测试（**跳过**）

判断：核心场景在 Phase 1-3 实施期已反复验证，批量压测在 PoC 已覆盖（200 节点 120fps）。

### Phase 4 期 Bug 修复（实测发现 9 个）

实施期间用户实测发现的体验问题：

- 边支持单击选中（`c61a81c0`）+ hover 视觉反馈（`5c63b8f4`）
- 反向边弧线偏移修正（`de104abf`）—— 双向边曲线不再重叠
- 多重图 label 沿法向展开（`4221acba`）—— 不重叠
- edgeRedrawToken per-edge 修复
- 边浮窗指针修正（多次迭代）

详见各 commit。

---

## 5. 性能基线（实测 vs spec § 10.1）

| 指标 | spec 目标 | 阈值（红线） | PoC 实测 | v1.3 实测 |
|------|---------|------------|---------|----------|
| 单节点首次（冷缓存） | < 30ms | 100ms | 25.5ms | 6.4ms |
| 单节点首次（热缓存） | < 5ms | 30ms | - | < 5ms（缓存命中） |
| 100 节点初始加载 | < 500ms | 2000ms | 187ms | < 200ms |
| 渲染 fps | 60+ | 30 | 120 | 120 |
| 字体首次加载 | < 200ms | 1000ms | 116ms | 27ms |
| MathJax 初始化 | < 50ms | 500ms | 3.2ms | 3.2ms |

**全部 6 项性能指标 ✅ 达标，多数远超目标。**

---

## 6. 已知遗留问题与未实施项

### 6.1 已知遗留

- **第 3 条以上的多重图边 hover 命中难**：raycaster Line threshold 8px 在弧线偏移大时命中精度下降。当前不影响功能，可调 threshold 或改为节点中心区域命中
- **PerfPanel 配置面板对普通用户专业度过高**：用户反馈"大部分人只懂得快慢"。后续可改为预设档位（"流畅 / 平衡 / 节能"）替代精确数字阈值
- **空 label 边/节点编辑入口**：当前需要先有内容才能 hover 命中编辑；空节点要靠双击节点圆触发，空边没有视觉锚点（用户反馈过）

### 6.2 跳过未做

- **跨平台字体一致性验证**：仅 macOS 实测
- **生产构建字体路径**：Vite `?url` 在 Electron 打包后未实测
- **Worker 异步管线**：PoC 阶段 200 节点 120fps，主线程无压力，推迟到 v2.0
- **字体加载超时回退**（spec § 10.3 fontFallbackOnTimeout）：F1 路径稳定，未触发，未实施
- **思维导图 / BPMN 等视图变种**：仅 KnowledgeEngine 实施，其他变种延后

### 6.3 性能优化机会

- **L2 GeometryCache 命中率监控**：实测命中率未做长期统计，可能需要调容量（默认 500）
- **节点拖动期间 SVG 缓存命中**：拖动只改 group.position，atomsToSvg 不重算，缓存命中率应接近 100%（未实测）

---

## 7. v1.4 候选主题

按对话中暴露的需求和缺口，v1.4 可能包含：

| 主题 | 价值 | 工作量估算 |
|------|------|----------|
| **导入功能**（MD frontmatter + body / Note 引用） | 用户快速搭建图谱 | 4-5 天 |
| **Note ↔ Graph 投影模型**（节点引用 Note 而非内嵌） | 三层架构投影模型落地一小步 | 1-2 周 |
| **思维导图变种 MindMapEngine** | 视图变种第一个非图谱实现 | 1-2 周 |
| **力导布局** | 自动整理节点位置 | 3-5 天 |
| **PerfPanel 预设档位** | 替代专业阈值，普通用户友好 | 1-2 天 |
| **节点 label hover 展开** | 长 label 缩略 + hover 大字号预览 | 2-3 天 |
| **顶部 menubar Graph 菜单** | 与其他 view 一致 | 半天 |

每项独立 spec + 独立 feature 分支。

---

## 8. 与 spec 的差异

### 8.1 超预期实施

- **Phase 4.2 自适应退化系统**：spec 计划写死阈值（"fps < 30 暂停 hover"），实际按用户要求做了完整 4 层架构（配置 / 策略 / 观测 / 调优）
- **边 hover 视觉反馈**：spec § 7 没明确，用户实测要求加，已实施

### 8.2 缩水实施

- **Phase 4.3 跨平台**：未实测
- **Phase 4.4 回归测试**：用户判断"测试意义不大"（核心场景已反复验证），跳过
- **思维导图变种**：spec § 10.2 列出但 v1.3 不实施，v1.4+ 处理

### 8.3 调整路径

- **PoC 阶段方案 C（MathJax）替代 KaTeX**：spec § 4.5 决议，正式实施沿用
- **字体子集化用 npm subset-font 而非 pyftsubset**：spec § 4.4.2 推荐 pyftsubset，实际选 subset-font（避免引 Python 工具链）

---

## 9. 决策日志（v1.3 实施期重要决策）

| 日期 | 决议 | 备注 |
|------|------|------|
| 2026-04-25 | Phase 1 前置：v2 数据模型升级合入 main | feature/graph-labels-v2 4 commits |
| 2026-04-25 | nodeMeshes 改为 nodeGroups + 完整重构 InteractionController | "不背技术债" 用户偏好 |
| 2026-04-25 | 字体子集化用 subset-font（npm 包，不引 Python） | 工程友好 |
| 2026-04-25 | PM schema 在 graph 模块独立写（不依赖 Note） | spec § 1.2 跨视图共享原则 |
| 2026-04-25 | EditOverlay popup 挂到 backdrop 内（不挂 CSS2DRenderer） | 修复事件传递死结 |
| 2026-04-25 | inline toolbar ∑ 按钮"选区直接格式化"（不弹空 popover） | 用户语义反馈 |
| 2026-04-26 | 反向边弧线偏移修正：bundle 镜像 index | 修复双向边重叠 |
| 2026-04-26 | 多重图 label 沿法向 EDGE_LABEL_PUSH 展开 | 修复同向多边 label 重叠 |
| 2026-04-26 | Phase 4.2 实施完整自适应系统（非简单写死阈值） | 用户偏好 |
| 2026-04-26 | Phase 4.3 / 4.4 跳过 | 用户判断"测试意义不大" |

---

## 10. 资源清单

### 代码（feature/graph-3d-rendering 全部 merge 进 main）

```
src/lib/atom-serializers/svg/         # 跨视图共享层
  ├── index.ts (atomsToSvg + L1 SvgCache)
  ├── lru.ts (通用 LRU)
  ├── blocks/                         # textBlock / mathInline / mathBlock / list
  ├── text-to-path.ts (opentype.js outline 化)
  ├── mathjax-svg.ts (MathJax v3 适配)
  ├── font-loader.ts (字体加载 + mark-aware 选择)
  └── fonts/                          # 6 个字体文件 ~1.5MB
      ├── Inter-Regular/Bold/Italic.ttf
      ├── NotoSansSC-Regular/Bold.ttf
      └── JetBrainsMono-Regular.ttf

src/plugins/graph/rendering/          # 渲染层
  ├── interfaces.ts (ShapeRenderer / ContentRenderer / ShapeLibrary)
  ├── NodeRenderer.ts
  ├── EdgeRenderer.ts
  ├── shapes/CircleShape.ts + ShapeLibraryImpl.ts
  ├── contents/SvgGeometryContent.ts (含 L2 GeometryCache)
  └── edit/                           # 编辑模式
      ├── EditOverlay.ts
      ├── edit-overlay.css
      └── pm/
          ├── schema.ts / plugins.ts / atom-bridge.ts / editor.ts
          ├── nodeviews.ts (math NodeView)
          ├── slash-menu.ts / inline-toolbar.ts / math-popover.ts

src/plugins/graph/perf/               # 自适应退化
  ├── PerfConfig.ts (localStorage 持久化)
  ├── PerfHistory.ts (会话摘要)
  ├── AutoTuner.ts (启动推荐)
  └── AdaptivePolicy.ts (状态机)

src/plugins/graph/components/
  ├── GraphView.tsx (主入口)
  └── PerfPanel.tsx (双 tab：stats / adapt)
```

### 依赖

| 包 | 版本 | 用途 |
|----|------|------|
| three | ^0.184 | 3D 渲染 + SVGLoader |
| opentype.js | ^1.3.4 | 字体 outline 化 |
| mathjax-full | ^3.2.2 | LaTeX → path SVG |
| katex | ^0.16.44 | math NodeView 实时预览 |
| prosemirror-* | 项目已有 | PM 编辑器全套 |
| @fontsource/noto-sans-sc | ^5.2.9 | 字体备选资源（v1.3 仅参考） |

字体资源 OFL 协议，可商用。

---

## 11. 后续路线

按本报告结论：

1. **v1.3 实施收尾**：本报告 commit 后 push + merge main
2. **`feature/graph-3d-rendering` 分支保留**：作为完整实施历史档案
3. **进入 v1.4 规划**：从 § 7 候选主题选择优先级，独立 spec + 独立 feature 分支
4. **观察期使用**：v1.3 投入实际使用 1-2 周，收集真实场景中的 bug 和需求，再决定 v1.4 范围

---

**v1.3 实施完整收尾。**
