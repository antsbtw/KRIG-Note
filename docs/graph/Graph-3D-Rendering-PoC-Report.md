# KRIG · Graph 3D Rendering PoC 评审报告

> PoC Report · 2026-04-25
>
> 对应规范：`docs/graph/Graph-3D-Rendering-PoC-Spec.md`
> 实施分支：`experiment/graph-3d-poc`
> 起止 commit：`95ff0403` … `1c0a4c62`（共 7 个 commit）

---

## 0. 评审结论

**结论：通过（Pass）**

PoC 完整覆盖了 spec § 2.1 列出的全部 4 个核心问题，外加 Day 4 临时追加的"交互可行性"问题（Q5），**全部正面验收**。各项实测指标在已知设备上**远超 spec 阈值**：

- 单节点端到端 spec 目标 < 100ms，实测稳态 **1.6-2.5ms**
- 5 节点初始加载 spec 目标 < 500ms，实测 **6 节点 153ms**（含字体冷加载 116ms）
- 缩放/平移流畅度 spec 目标 60fps，实测 **120fps（顶到屏幕刷新率上限）**

**建议**：PoC 通过，进入正式 spec 撰写阶段（`Graph-3D-Rendering-Spec.md`），再启动 6-8 周的全量实施。

---

## 1. 实施时间盒

| 天 | 任务 | 实际 |
|----|------|------|
| 1 | 字体方案验证 + KaTeX SVG 验证 | F1（opentype.js）一次跑通 |
| 2 | minimal block-svg-serializer | textBlock + mathInline 完整 |
| 2 | KaTeX 改 MathJax（方案 C） | MathJax v3 fontCache:'none' 直接输出 path SVG |
| 3 | 样本扩展 | 6 个节点（含矩阵、求和、开方、display math、多 atoms 堆叠） |
| 4 | raycaster hover 交互 | 完整 hover 链路 + 高亮反馈 |
| 5 | 字体子集化 | 跳过实施，作分析章节进报告 |
| 6-7 | 100 节点压测 | 实测扩到 200 节点 |
| 8 | 评审报告 | 本文档 |

总计 **8 天**，与 spec 时间盒一致。

---

## 2. 核心问题逐项验收

### Q1 SVGLoader 路线在 Three.js 里画文字 + 公式的清晰度

**验收标准**：1080p 屏幕下，节点默认尺寸（radius ≈ 24）的公式肉眼可读；中文文字不糊。

**实测**：

- 西文（Inter Regular）：`Hello PoC` / `Energy = ` / `f(x) = ` 全部锐利可读
- 中文（Noto Sans SC Regular）：`中文 mixed 测试 ABC` / `巴塞尔级数：` 清晰可辨，笔画完整
- 公式（MathJax v3 SVG）：`E = mc²` / `√(x² + 1/x)` / 求和号 + 上下标 / 2×2 矩阵全部正确渲染，几何形状无失真

**结论**：✅ **通过**。文字清晰度在 120Hz 高刷屏上甚至可媲美 DOM 子像素抗锯齿。KaTeX strut 撑高问题彻底消除。

### Q2 节点形状与内容渲染解耦的架构能否成立

**验收标准**：形状（ShapeRenderer）与内容（ContentRenderer）作为两个独立模块各自迭代，互不依赖。

**实测**：

- `ShapeRenderer` 接口（4 个方法：createMesh / fitToContent / getContentAnchor / dispose）已实现
- `ContentRenderer` 接口（3 个方法：render / getBBox / dispose）已实现
- `NodeRenderer` 作为组合器，独立于具体形状和内容实现
- PoC 只实现了 `CircleShape` + `SvgGeometryContent`，但**接口完整足以容纳**思维导图（`RoundRectShape`）、BPMN（`TaskShape` / `GatewayShape` / `EventShape`）等未来变种

**结论**：✅ **通过**。架构骨架在代码层面清晰可见，新形状/新内容渲染器可独立扩展，无需修改其他模块。

### Q3 内容尺寸如何反向影响形状/布局

**验收标准**：至少有一个明确的"内容 bbox 反馈给形状"接口被定义并跑通（即使图谱变种本身不用）。

**实测**：

```ts
// NodeRenderer.createNode（src/plugins/graph/poc/NodeRenderer.ts）
const bbox = this.content.getBBox(contentObj);
this.shape.fitToContent?.(shapeMesh, bbox);
```

链路完整调用。`CircleShape.fitToContent` 当前为 no-op（图谱节点圆固定半径），但接口已定义并被调用。未来 `RoundRectShape.fitToContent(mesh, bbox)` 可直接在此接口上实现"框尺寸 = 内容包围盒"。

**结论**：✅ **通过**。bbox 反馈链路打通，思维导图等需要"形状包围内容"的变种无架构障碍。

### Q4 端到端性能

**验收标准**：单节点 Atom[] → 出现在场景 < 100ms；5 节点初始加载 < 500ms；缩放/平移 60fps。

**实测**（120Hz MacBook 屏幕）：

| 节点数 | setup 总耗时 | avg/节点 | last 节点 | fps |
|--------|------------|----------|----------|-----|
| 6 (showcase) | **153ms** | 25.5ms | 4.5ms | **120** |
| 50 | **125ms** | 2.5ms | 2.5ms | **119** |
| 100 | **187ms** | 1.9ms | 2.2ms | **120** |
| 200 | **328ms** | 1.6ms | 2.6ms | **120** |

**字体冷加载分解**：

- Inter Regular (402KB)：10.7ms
- Noto Sans SC Regular (8MB)：104.6ms
- MathJax 初始化：3.2ms
- 合计字体冷加载约 **116ms**（一次性，浏览器缓存命中后接近 0）

**关键发现**：

- 200 节点 setup 仅 328ms，比 spec 目标的"5 节点 < 500ms"快了一个数量级
- 节点数从 6 → 200 时，**avg/节点反而下降**（25.5ms → 1.6ms）—— 证实首次成本来自字体/MathJax 初始化，稳态渲染极快
- 200 节点全场 120fps，**raycaster 实时跟踪鼠标无任何延迟**

**结论**：✅ **远超目标**。

### Q5 交互可行性（PoC 临时追加）

**验收标准**：raycaster 能命中 3D 几何节点；hover 高亮工作；切换无延迟。

**实测**：

- `THREE.Raycaster.intersectObjects` 命中节点 group 的 CircleShape mesh
- hover 时圆色变橙 (#ffaa3b) + cursor 变 pointer + 顶栏显示 `hover: nX`
- 200 节点同时存在时，hover 切换零延迟

**结论**：✅ **通过**。未来所有交互（点击、拖动、双击编辑、节点选择、边缘拖出新边）走相同 raycaster 路径，无技术阻碍。

---

## 3. 技术决策与实现路径

### 3.1 字体路径：F1（opentype.js + getPath）

PoC spec § 3.4 列出 F1/F2/F3/F4 多路径回退方案。**实测 F1 一次跑通**，未触发 F2-F4 备选。

实现要点（`src/lib/atom-serializers/svg/`）：

- `font-loader.ts`：opentype.parse + 字符级字体选择（CJK→Noto SC，其余→Inter）
- `text-to-path.ts`：按字体分段调用 `font.getPath().toPathData()`，输出多个 `<path d="..." fill="#dddddd" />` 串联

### 3.2 公式路径：方案 C（MathJax SVG）

放弃 KaTeX 改 MathJax v3，原因：
- KaTeX 输出 HTML（含 `<span>` 嵌套定位），需要文字 outline 化才能进 SVGLoader
- MathJax 配置 `fontCache: 'none'` 后**直接输出自包含 path SVG**，无需文字 outline 化

实现要点（`src/lib/atom-serializers/svg/`）：

- `mathjax-svg.ts`：browserAdaptor + TeX + SVG 单例懒加载（首次 ~3ms）
- `blocks/mathInline.ts` / `blocks/mathBlock.ts`：提取 viewBox + 内层 g，包成 `<g transform="...">`，平移到目标基线
- `currentColor` 替换为 `#dddddd`（避免 SVGLoader Unknown color 警告）

### 3.3 渲染管线

```
Atom[]
  ↓ atomsToSvg()                      [src/lib/atom-serializers/svg/index.ts]
SVG 字符串（含 path-only）
  ↓ SVGLoader.parse()                 [three/examples/jsm/loaders/SVGLoader]
SVGResult { paths: [...] }
  ↓ SVGLoader.createShapes() + ShapeGeometry
THREE.Mesh × N（每个 path 一个）
  ↓ THREE.Group 包装 + 翻转 y 轴
作为 NodeRenderer 输出的 child
  ↓
进入 Three.js 场景
```

### 3.4 形状/内容分离架构

```ts
interface ShapeRenderer {
  createMesh(node): THREE.Object3D;
  fitToContent?(mesh, contentBBox): void;
  getContentAnchor(mesh): THREE.Vector3;
  dispose(mesh): void;
}

interface ContentRenderer {
  render(atoms): Promise<THREE.Object3D>;
  getBBox(rendered): THREE.Box3;
  dispose(rendered): void;
}

class NodeRenderer {
  constructor(shape, content) { ... }
  async createNode(node) {
    const shapeMesh = shape.createMesh(node);
    const contentObj = await content.render(node.atoms);
    const bbox = content.getBBox(contentObj);
    shape.fitToContent?.(shapeMesh, bbox);
    contentObj.position.copy(shape.getContentAnchor(shapeMesh));
    return new THREE.Group().add(shapeMesh, contentObj);
  }
}
```

未来扩展：

- 思维导图：`new NodeRenderer(new RoundRectShape(), new SvgGeometryContent())`
- BPMN：`new NodeRenderer(new TaskShape() | new GatewayShape() | ..., new SvgGeometryContent())`
- 不同视图变种**复用同一 ContentRenderer**（即同一序列化器）

---

## 4. 工程优化建议（正式实施期任务）

PoC 已证明可行性，但以下工程优化项**不在 PoC 范围**，需在正式 spec 中规划：

### 4.1 字体子集化

**现状**：Noto Sans SC 全字 8MB，首次加载 105ms。

**优化路径**（按工作量从轻到重）：

| 路径 | 描述 | 大小目标 | 工作量 |
|------|------|---------|-------|
| **A** | pyftsubset 构建期生成常用字（GB 2312 一级 3500 字） | 200-400KB | 1-2 天 |
| **B** | pyftsubset GB 2312 全集（7000 字） | 400-800KB | 1-2 天 |
| **C** | fontsource 多分包路由（unicode-range 按需加载） | 25KB × N | 5-7 天 |
| **D** | woff2 + 自动子集化 + Workbox 缓存 | < 100KB 首屏 | 2-3 周 |

**建议正式实施期采用 A**（最朴素 + 收益最大）。完整工程化（D）作为 v2 优化。

### 4.2 节点缓存与增量更新

**现状**：节点变更触发整个 Atom[] → SVG → 几何 → Mesh 流水线。

**优化项**：

- 序列化器层缓存：相同 Atom[] 的 SVG 字符串缓存（hash 索引）
- ShapeGeometry 层缓存：相同 SVG 的几何复用
- 增量 dispose：节点变更时只清理变更部分，不重建整个 group

**估算工作量**：5-7 天。

### 4.3 Web Worker 异步渲染

**现状**：所有渲染在主线程。

**问题**：未来若节点数到 1000+，主线程渲染可能阻塞 UI。

**优化项**：

- atomsToSvg 在 Worker 内执行（含 MathJax 渲染、字体 outline 化）
- 主线程只负责 SVGLoader.parse + ShapeGeometry 生成（这两步快）

**估算工作量**：5-7 天，需改造 mathjax-svg 为 Worker 兼容（MathJax v3 用 liteAdaptor 而非 browserAdaptor）。

### 4.4 编辑模式

**现状**：PoC 只验证显示。编辑态（双击 → DOM PM 编辑器覆盖）未实现。

**正式实施期范围**：

- 双击节点 → 几何 mesh 隐藏 → DOM 浮层 PM 编辑器覆盖
- 编辑提交 → 新 Atom[] 重新走管线 → 替换 mesh
- 浮层销毁 → 几何 mesh 恢复

**估算工作量**：3-4 天。

### 4.5 节点尺寸 / 布局算法适配

**现状**：节点圆固定半径 24，内容溢出在下方（图谱风格）。

**正式实施期范围**：

- 力导布局算法适配：节点尺寸变化（含内容 bbox）影响碰撞、连线起止点
- 视图变种差异：思维导图节点 = 内容包围盒，BPMN 节点 = 形状自身尺寸

**估算工作量**：3-5 天。

### 4.6 边的渲染

**现状**：PoC 完全没实现边（连线 + 弧线 + 多重图）。

**正式实施期范围**：

- 边几何：Line / 二次贝塞尔曲线 + 箭头几何
- 边 label：复用 NodeRenderer 思路，作 EdgeRenderer
- 多重图弧线偏移（已在 v1.1 spec 决议）

**估算工作量**：3-4 天。

---

## 5. 风险与未解问题

### 5.1 已暴露的小问题

- **SVG viewBox 溢出**：当前 viewBox 200×60 写死，文字内容很长时会"超出 viewBox"。SVGLoader 解析的是 path 数据本身，不受 viewBox 约束，但仍是隐患。建议正式实施期改为按内容自适应 viewBox。
- **节点 anchor 偏移**：CircleShape 把内容定位在 `(0, -radius - 4, 0.1)`，多行内容（n5 三行）会向下溢出。需要更智能的内容定位策略（vertical-align 选项：top / middle / bottom）。
- **font-cache LRU**：opentype.parse 后的 Font 对象常驻内存，多字体场景需要 LRU 限制。

### 5.2 尚未验证的场景

- **极长文本**（单 textBlock 含 100+ 字符）：未测试换行/截断
- **极复杂公式**（多页公式、Bra-ket 物理记号、化学方程式）：未测试
- **图片 / 视频 / 音频 atom**：PoC 不在范围
- **代码块 atom**：等 CodeMirror 6 集成后再考虑

### 5.3 未解的工程问题

- **MathJax 在 Web Worker 中的兼容性**：当前用 browserAdaptor，Worker 中需切换 liteAdaptor，需实测
- **跨平台字体渲染一致性**：Windows / Linux 上 Inter / Noto SC 渲染是否与 macOS 一致，未验证
- **打包后 ttf 资源加载**：dev 模式下走 vite ?url，生产构建后路径行为需验证

---

## 6. 决策日志

| 日期 | 决议 | 备注 |
|------|------|------|
| 2026-04-25 | F1 字体路径一次跑通 | opentype.js + Inter + Noto SC，无需触发 F2-F4 备选 |
| 2026-04-25 | KaTeX → MathJax（方案 C） | fontCache:'none' 直接输出 path SVG，避免文字 outline 化复杂度 |
| 2026-04-25 | currentColor 替换为 hardcode 灰 | 避免 SVGLoader Unknown color 警告 |
| 2026-04-25 | 字体子集化跳过 PoC 实施 | 工程优化项，写入报告 § 4.1，正式实施期再做 |
| 2026-04-25 | PoC 通过，建议进入正式 spec 阶段 | 全部 5 个核心问题正面验收，性能远超目标 |

---

## 7. 资源清单

### 代码（experiment/graph-3d-poc 分支）

```
src/lib/atom-serializers/svg/      # 跨视图共享层
  ├── index.ts
  ├── blocks/
  │   ├── textBlock.ts
  │   ├── mathInline.ts
  │   └── mathBlock.ts
  ├── text-to-path.ts              # F1 字体 outline 化
  ├── mathjax-svg.ts               # MathJax 适配
  ├── font-loader.ts               # opentype.js 字体加载
  └── fonts/
      ├── Inter-Regular.ttf        (402KB, OFL)
      └── NotoSansSC-Regular.ttf   (7.9MB, OFL subset OTF)

src/plugins/graph/poc/             # PoC 沙盒
  ├── PocPanel.tsx                 # 入口（含 preset 切换 + fps）
  ├── PocScene.ts                  # Three.js 场景 + raycaster
  ├── NodeRenderer.ts              # 形状/内容组合器
  ├── shapes/
  │   └── CircleShape.ts
  ├── contents/
  │   └── SvgGeometryContent.ts
  ├── sample-generator.ts          # 100/200 节点压测样本
  └── types.ts                     # 接口定义
```

### 依赖

| 包 | 版本 | 用途 |
|----|------|------|
| three | ^0.184 | 3D 渲染 + SVGLoader |
| opentype.js | ^1.3.4 | 字体 outline 化 |
| mathjax-full | ^3.2.2 | LaTeX → SVG path |
| @fontsource/noto-sans-sc | ^5.2.9 | 字体子集化资源（PoC 暂未使用） |

### 资源（OFL 协议，可商用）

- Inter Regular: https://github.com/rsms/inter
- Noto Sans SC Regular: https://github.com/notofonts/noto-cjk

---

## 8. 后续路线

按本报告结论"通过"建议：

1. **撰写正式 spec**：`docs/graph/Graph-3D-Rendering-Spec.md`，把本报告 § 4 的工程优化作为 v1.0 实施任务清单
2. **撰写 v1.3 GraphView spec**：`docs/graph/KRIG_GraphView_Spec_v1.3.md`，把 3D 渲染管线作为 v1.3 核心决议
3. **启动正式实施**：新分支 `feature/graph-3d-rendering`（从 main 起），按 § 4 优先级推进
4. **PoC 分支保留**：`experiment/graph-3d-poc` 作为历史档案永久保留

PoC 沙盒代码（`src/plugins/graph/poc/` + GraphView toolbar 的 PoC 按钮）**不进 main**。正式实施时把成熟的部分（接口、序列化器、字体管线）迁移到 graph 模块和 lib 模块，PoC 沙盒丢弃。

---

## 附录 A：截图证据

PoC 阶段产出的截图（用户提供）证明：

1. **Day 0 脚手架验证**：3 节点占位矩形，3.1ms 全场加载
2. **Day 1 字体路径**：3 节点真实文字（Hello PoC / Energy = / 中文测试）
3. **Day 2 MathJax 接入**：n2 节点显示 `Energy = E = mc²`
4. **Day 3 6 节点扩展**：含矩阵、求和、开方、display math、多 atoms 堆叠
5. **Day 4 hover 交互**：n4 节点橙色高亮 + 顶栏 `hover: n4`
6. **Day 6-7 100/200 节点压测**：120fps 稳定，setup < 350ms

截图已通过对话保存，未独立归档。

---

**报告完。建议进入正式 spec 阶段。**
