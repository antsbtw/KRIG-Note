# KRIG-Note 讨论上下文

> 供新对话接手时快速理解背景，继续往下讨论。

---

## 背景

**mirro-desktop**（`/Users/wenwu/Documents/VPN-Server/mirro-desktop`）是一个 Electron + React + ProseMirror 的知识工具，目前处于实验阶段，功能快速迭代中。

用户决定：不急于重构，而是在 mirro-desktop 旁边建立 **KRIG-Note**（`/Users/wenwu/Documents/VPN-Server/KRIG-Note/`）作为蓝图库，逐步记录重构原则和设计思路。等 mirro-desktop 的框架和功能基本成熟后，再基于这些原则进行高度抽象的重构。

---

## 已完成的工作

### 1. 确定了 principles.md（重构原则）

已写入 7 个章节的原则，经过讨论确认：

| 章节 | 核心内容 |
|------|----------|
| 一、分层设计 | 单向依赖、层间契约、可替换性 |
| 二、抽象层次 | 相似即抽象、先具体后抽象、已识别的抽象机会（EmbedBlock、Converter、Container） |
| 三、Block + Container 二元模型 | 只有两种东西、能力不丢失、整体移动、缩进即包含 |
| 四、模块自包含 | 一类节点一个模块、导出契约、注册即生效 |
| 五、框架与插件分离 | **最高层次原则**——面向用户的功能都是插件；4 层 UI 框架（Application → Window/Shell → Workspace → NavSide + Slot） |
| 六、命名与可描述性 | 万物皆可命名（命名即设计）；用产品描述产品（自举验证） |
| 七、待沉淀 | 存储层、多视图同步、AI 集成层 |

### 2. 确定了 UI 框架 4 层结构

```
macOS Application（Application Menu）
  └─ Window (Shell)
       └─ Workspace
            ├─ NavSide（+ 自己的 Overlays）
            └─ Slot（+ 自己的 Overlays）
                 └─ View + Toolbar（+ 自己的 Overlays）
```

关键决策：
- **Window = Shell**，1:1 关系，不再区分
- **Workspace 是逻辑实体**，不是 UI 区域。WorkspaceBar 只是管理 Workspace 的 Tab 栏控件
- **NavSide 是共享容器**，内容由当前活跃 Workspace 的 WorkMode 驱动
- **Overlay 属于子视图**，不是独立的层。NavSide、Slot、View、Toolbar 各自管理自己的浮窗
- **View 间通信**经过 main 进程路由，不直接通信

### 3. 完成了组件定义文档

- **Application Menu**（`application-menu/定义.md`）：三类 Menu（通用操作、工作空间、Help），零硬编码，全部注册机制
- **NavSide**（`navside/定义.md`）：6 个区域（Layout Toggle、Brand Bar、ModeBar、Action Bar、Search、Content List），框架硬编码 1 个 + 插件硬编码 1 个 + 注册机制 4 个。注册接口以 workModeId 为键
- **WorkMode**（`ui-framework/workmode.md`）：注册制定义，ViewType + variant 组合，驱动 NavSide + Left Slot
- **Workspace**（`ui-framework/workspace.md`）：状态模型、生命周期、切换机制、持久化策略
- **UI Framework**（`ui-framework/定义.md`）：4 层结构总览，各层职责，Overlay 归属原则
- **视图层级定义**（`ui-framework/视图层级定义.md`）：完整的 L0-L3 层级定义
- **View**（`ui-framework/view.md`）：View 接口定义（结构、生命周期、Type + Variant、注册机制）
- **View 协同协议**（`ui-framework/view-protocol.md`）：View 间协同协议（translate/anchor/page-sync，匹配表，注册制）
- **技术栈**（`ui-framework/tech-stack.md`）：Electron + React + TypeScript + Vite，选型理由和约束

### 4. 生成了 principles-draft.md（原则提炼草稿）

从 mirro-desktop 全面分析提炼的所有设计原则，标记了 ✅（保留）、❓（待讨论）、❌（不带入重构）。**尚未逐条与用户讨论确认**。

---

## 讨论中形成的关键共识

1. **mirro-desktop 是实验场，KRIG-Note 是蓝图库**——先验证后沉淀，不提前设计
2. **记录原则，不记录实现细节**——具体代码会在重构时全部重写
3. **抽象层次分析比单个 pattern 更重要**——识别相似功能、提取共同抽象是重构的最大收益点
4. **分层设计始终是最重要的**——用户多次强调
5. **框架与插件分离**——从用户界面结构自顶向下定义框架，而非从代码模块出发
6. **注册优先，零硬编码**——除框架自身行为和基础能力外，所有功能通过注册机制实现
7. **命名即设计**——解释不清楚代表不可实施；用产品自身来描述产品是终极验证
8. **目录结构从简**——需要时再拆分
9. **Overlay 属于子视图**——谁的浮窗谁管理，不需要全局 Overlay 层
10. **WorkMode 注册制**——WorkMode 不是硬编码枚举，而是 ViewType + variant 的注册组合。LayoutMode 废弃，Slot 布局由 WorkMode + 用户操作共同决定
11. **ViewType 4 种**：note、pdf、web、graph。ThoughtView 是 NoteView 的 variant（thought），AI 是 WebView 的 variant（ai）
12. **Slot 是纯布局位置**——只有 left/right + 装载的 View，不感知 View 类型，不参与通信
13. **View = Toolbar + Content + Overlays**——内部结构由框架统一约束，Toolbar 固定顶部，Content 占据剩余空间
14. **View 默认孤立**——任意 View 组合默认无协同。协同行为由协同协议层查表匹配注入，View 自身不知道对面是谁
15. **协同协议注册制**——translate（翻译同步）、anchor（锚点关联）、page-sync（页码关联）三种协议，通过注册声明匹配规则
16. **Companion 概念废弃**——Toolbar 上触发 Right Slot 操作的按钮就是普通 Toolbar action，不需要特殊概念
17. **translate 不是 variant**——翻译同步是两个 WebView 之间的协同协议，不是单个 View 的属性

---

## 下一步可以讨论的方向

- **principles-draft.md 中 ❓ 标记的原则**：逐条讨论是否值得保留
- **待沉淀领域**：存储层设计、多视图同步、AI 集成层
- **ui-framework/定义.md 同步更新**：当前内容与新决策有部分不一致，需要同步

---

## 文件清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `principles.md` | ✅ 已确认 | 重构原则（8 章节） |
| `principles-draft.md` | 📝 待讨论 | 从 mirro-desktop 提炼的全部原则草稿 |
| `ui-framework/定义.md` | ✅ 已确认 | UI 框架 4 层结构总览（已同步 WorkMode + View 接口引用） |
| `ui-framework/视图层级定义.md` | ✅ 已确认 | 视图层级完整定义（已更新为 WorkMode 注册制） |
| `ui-framework/workmode.md` | ✅ 已确认 | WorkMode 注册制定义 |
| `ui-framework/workspace.md` | ✅ 已确认 | Workspace 状态模型、生命周期、持久化 |
| `ui-framework/view.md` | ✅ 已确认 | View 接口定义（结构、生命周期、Type+Variant、注册） |
| `ui-framework/view-protocol.md` | ✅ 已确认 | View 间协同协议（匹配表、行为明细、注册制） |
| `ui-framework/tech-stack.md` | ✅ 已确认 | 技术栈选型（Electron + React + TS + Vite） |
| `ui-framework/license.md` | ✅ 已确认 | 授权管理（订阅制三档，框架预留，待功能完成后实施） |
| `ui-framework/storage.md` | 📝 初稿 | 存储层设计（核心存储 + 知识图谱三元组模型） |
| `ui-framework/block-system.md` | ✅ 已确认 | Block 注册制（BlockDef + capabilities + Tab Container 升级） |
| `application-menu/定义.md` | ✅ 已确认 | Application Menu 定义 |
| `navside/定义.md` | ✅ 已确认 | NavSide 定义（已更新为 WorkMode + 注册接口） |
| `SESSION-CONTEXT.md` | 📌 上下文 | 本文件，供新对话接手 |

### 双轨验证

- **KRIG-Note/*.md** = 设计的唯一真相源（AI 读写）
- **mirro-desktop/docs/KRIG-Note设计/** = NoteView 展示验证（人在 App 里阅读，验证编辑器表达能力）
- 修改始终在 KRIG-Note/ 源文件中进行，NoteView 只用于导入展示

### AI CLI 接口

- **scripts/note-cli.mjs** — AI 操作 NoteView 数据的标准接口
- 支持 KRIG Markdown 扩展格式（`krig-markdown/规范.md`），无损覆盖所有 Block 类型
- 命令：list-folders, create-folder, list-notes, import, import-dir, read, export, delete
- 双格式：Markdown（有损方便）/ Atom JSON（无损完整）

### KRIG Markdown 扩展格式

- **krig-markdown/规范.md** — 扩展格式规范
- 标准 Markdown 直接映射 12 种 Atom 类型
- 容器语法 `:::type[params]...:::` 覆盖 callout、toggleHeading、toggle-list、columns
- 嵌入语法 `::type[content]{attrs}` 覆盖 video、audio、tweet、note-link
- `$$...$$` 和 `$...$` 覆盖数学公式
