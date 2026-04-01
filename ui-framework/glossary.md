# KRIG Note — 字汇表（Glossary）

> **目的**：统一项目中所有术语的命名和定义。
> 任何讨论和代码中使用的术语必须与本表一致。
> 如果一个概念解释不清楚，说明它不具备可实施性。

---

## 一、应用层级（L0-L3）

| 术语 | 英文 | 定义 |
|------|------|------|
| **应用** | Application | macOS/Windows 桌面应用本身（L0） |
| **窗口** | Window / Shell | 应用的主窗口，1:1 关系（L1） |
| **工作空间** | Workspace | 独立的工作环境，逻辑实体，不是 UI 区域（L2） |
| **工作空间栏** | WorkspaceBar | 窗口顶部的 Tab 栏，管理 Workspace 的创建/切换/关闭 |
| **导航侧栏** | NavSide | 窗口左侧的导航操作区域，内容由 WorkMode 驱动 |
| **插槽** | Slot | Workspace 内的布局位置（Left / Right），容纳 View |
| **分割线** | Divider | Left Slot 和 Right Slot 之间的可拖拽分割线 |
| **视图** | View | Slot 中渲染的内容单元，由插件实现（L3） |

---

## 二、WorkMode 与 View

| 术语 | 英文 | 定义 |
|------|------|------|
| **工作模式** | WorkMode | Workspace 的主模式，驱动 NavSide 内容 + Left Slot 默认 View。注册制 |
| **视图类型** | ViewType | View 的基础类型分类：`note` / `pdf` / `web` / `graph` |
| **变体** | Variant | 同一 ViewType 下的行为变体（如 `note:thought`、`web:ai`） |

---

## 三、NoteView 编辑器

| 术语 | 英文 | 定义 |
|------|------|------|
| **NoteView** | NoteView | 笔记编辑器 View 插件，基于 ProseMirror |
| **NoteFile** | NoteFile | 一个笔记文档——用户可感知的操作单元（新建、打开、保存的对象） |
| **noteTitle** | noteTitle | NoteFile 的标题 Block，文档的第一个 Block，大字号显示 |

---

## 四、Block 系统

| 术语 | 英文 | 定义 |
|------|------|------|
| **Block** | Block | 编辑器中最小的独立内容单元（paragraph、heading、codeBlock、image...） |
| **Container** | Container | 包含其他 Block 的组织节点，继承 Block 的全部能力（blockquote、toggleHeading、table...） |
| **Block 定义** | BlockDef | Block 的一站式注册对象，包含 nodeSpec、nodeView、converter、capabilities 等 |
| **Block 注册表** | BlockRegistry | 管理所有已注册 Block 的注册表，框架从中自动构建 Schema/NodeView/Plugin/SlashMenu |
| **能力声明** | Capabilities | Block 声明自己支持的操作（turnInto、marks、canIndent...），菜单系统从中派生 |
| **Tab 容器** | Tab Container | Block 的多面板升级形态，通过 Tab 栏切换不同视角 |
| **面板** | Tab Pane | Tab Container 中的一个面板（渲染型或编辑型） |

---

## 五、菜单系统

NoteView 的菜单系统由框架统一提供 UI，从 BlockRegistry 读取 Block 的声明来决定显示内容。Block 不关心菜单长什么样，Block 只声明 capabilities。

| 术语 | 英文 | 归属 | 数据源 | 定义 |
|------|------|------|--------|------|
| **Slash 菜单** | SlashMenu | NoteView 框架 | BlockRegistry 全量（所有 slashMenu 不为 null 的 Block） | 输入 `/` 触发。本质：**创建新 Block** |
| **手柄** | Handle | NoteView 框架 | 当前 Block 的 capabilities（canDrag、turnInto、canDelete）+ customActions | Block 左侧的拖拽手柄 + 操作菜单。本质：**操作已有 Block** |
| **浮动工具栏** | FloatingToolbar | NoteView 框架 | 当前 Block 的 capabilities.marks | 选中文本后出现。本质：**文本格式化（Mark 操作）** |
| **右键菜单** | ContextMenu | NoteView 框架 | 当前 Block 的 capabilities + customActions + 剪贴板操作 | 右键点击触发。本质：**Block 操作 + 剪贴板** |
| **应用菜单** | Application Menu | 应用框架 | MenuRegistry | macOS/Windows 菜单栏，全局稳定，不随 WorkMode 变化 |

---

## 六、操作系统

| 术语 | 英文 | 定义 |
|------|------|------|
| **Block Action** | Block Action | NoteView 框架级操作层。统一管理所有 Block 级操作（select / delete / duplicate / cut / copy / paste / move / turnInto）。菜单组件只调用 blockAction.xxx()，不直接操作 ProseMirror |
| **Block 选中** | Block Selection | 选中整个 Block（蓝色边框高亮），由框架级 Plugin 管理。与文字编辑互斥——选中模式下不可编辑，开始编辑时选中取消 |
| **Block 剪贴板** | Block Clipboard | Block 级的内部剪贴板，独立于系统剪贴板。存储 ProseMirror Node 的 JSON，用于 Block 级 cut/copy/paste |
| **Block 转换** | turnInto | 将一个 Block 转换为另一种类型（如 paragraph → heading），保留文本内容 |
| **容器规则** | ContainerRule | Container 的约束（必填首子类型、不兼容时的转换策略） |
| **Block 目标** | BlockTarget | Block 操作的目标：位置 + 节点 + 父容器上下文 |
| **Enter 行为** | EnterBehavior | Block 声明的回车键行为。action: split / newline / exit。exitCondition: empty-enter / double-enter / always。框架统一处理，Block 只做声明 |
| **能力声明** | Capabilities | Block 声明自己支持的操作。菜单系统和 Block Action 从中派生显示内容和前置检查 |

---

## 七、数据层

| 术语 | 英文 | 定义 |
|------|------|------|
| **Atom** | Atom | Block 级数据单元，存储层的最小单位 |
| **转换器** | Converter | Atom ↔ ProseMirror 的双向转换器 |
| **知识节点** | Node | 知识图谱中的基本粒子（任何事物、概念、实体） |
| **三元组** | Triple | 知识图谱中的关系：(主体, 关系, 客体)，predicate 是自由文本 |

---

## 八、通信

| 术语 | 英文 | 定义 |
|------|------|------|
| **View 消息** | ViewMessage | View 间的通信消息，JSON 格式（protocol + action + payload） |
| **协同协议** | Protocol | 两个 View 之间的通信许可，由注册表查表匹配。宽松模式：有协议 = 全部转发 |
| **消息路由** | Message Router | main 进程的消息转发机制，发给"对面 Slot 的 View" |

---

## 九、存储

| 术语 | 英文 | 定义 |
|------|------|------|
| **Session** | Session | 应用的布局状态（Workspace 列表、WorkMode、dividerRatio），持久化到 JSON 文件 |
| **核心存储** | Core Storage | 编辑器数据（note、thought、highlight、pdf_book、folder、media） |
| **知识图谱** | Knowledge Graph | 推理数据（node + triple + atom_index），从文档内容异步提取 |

---

## 十、授权

| 术语 | 英文 | 定义 |
|------|------|------|
| **授权级别** | LicenseTier | `free` / `pro` / `premium`，订阅制三档 |

---

## 使用规则

1. **代码中**：变量名、类型名、文件名必须使用本表的英文术语
2. **文档中**：中文描述时使用本表的中文术语
3. **讨论中**：新概念出现时，先在本表中定义，再使用
4. **冲突时**：以本表为准，更新代码或文档以保持一致
