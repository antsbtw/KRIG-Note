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
- **NavSide 是共享容器**，内容由当前活跃 Workspace 驱动
- **Overlay 属于子视图**，不是独立的层。NavSide、Slot、View、Toolbar 各自管理自己的浮窗
- **Slot 间通信**是贯穿各层的机制，不是独立的层

### 3. 完成了组件定义文档

- **Application Menu**（`application-menu/定义.md`）：三类 Menu（通用操作、工作空间、Help），零硬编码，全部注册机制
- **NavSide**（`navside/定义.md`）：6 个区域（Layout Toggle、Brand Bar、Workspace Tabs、Action Bar、Search、Content List），框架硬编码 1 个 + 插件硬编码 1 个 + 注册机制 4 个
- **UI Framework**（`ui-framework/定义.md`）：4 层结构总览，各层职责，Overlay 归属原则

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
10. **参考 mirro-desktop 已有文档**——`docs/视图层级定义.md` 的 L0-L5 层级定义是重要参考

---

## 下一步可以讨论的方向

- **Slot 的详细定义**：布局方式、尺寸策略、View 的装载机制
- **View 接口定义**：生命周期、Toolbar 管理、Slot 通信的接口契约
- **Workspace 的详细定义**：状态管理、模式切换、布局模式
- **通信协议设计**：Slot 间、View 间的消息格式和路由机制
- **principles-draft.md 中 ❓ 标记的原则**：逐条讨论是否值得保留
- **待沉淀领域**：存储层设计、多视图同步、AI 集成层

---

## 文件清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `principles.md` | ✅ 已确认 | 重构原则（8 章节） |
| `principles-draft.md` | 📝 待讨论 | 从 mirro-desktop 提炼的全部原则草稿 |
| `ui-framework/定义.md` | ✅ 已确认 | UI 框架 4 层结构总览 |
| `ui-framework/视图层级定义.md` | ✅ 已确认 | 视图层级完整定义（参照 mirro-desktop 格式） |
| `application-menu/定义.md` | ✅ 已确认 | Application Menu 定义 |
| `navside/定义.md` | ✅ 已确认 | NavSide 定义 |
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
