# KRIG-Note 全局数据模型分层抽象架构设计 (Data Model Architecture)

> **文档目的**：在原有 `Atom体系` 的基础上，进一步将系统的数据生命周期进行全链路的抽象与分级。彻底解决“状态乱飞”、“存储与渲染耦合”、“不同系统之间难以互通”的历史遗留问题。

为了让数据的定义真正成为界定模块边界的“宪法”，我们将 KRIG-Note 的数据模型划分为**四个正交（相互解耦）的维度**：

---

## 1. 语义层（Semantic Layer）—— “世界是什么”
**核心职责**：管理数据的本质含义、实体及其关联。它完全脱离于“文档长什么样”，只关心“知识是什么”。
**受众**：知识图谱（Knowledge Graph）、AI 搜索引擎、查询引擎（SurrealDB）。

*   **1.1 实体抽象 (Entity)**
    *   Node（知识节点）：如概念、人物、定理。
    *   Thought（碎片思考）：不附着于特定文档的独立思想。
*   **1.2 关系抽象 (Relation)**
    *   Triple（三元组）：如 `(Node:熵增) -[引用]-> (Book:热力学)`。
*   **1.3 溯源抽象 (Provenance / Traceability)**
    *   `FromReference`：精确定义某段知识是“谁、在什么时候、从哪一页 PDF / 哪个网页 / 哪段 AI 对话”中得来的。
*   **1.4 意图模型 (Intent)**
    *   用户的原始动机，如 `SearchIntent` (查找意图)、`NavigateIntent` (跳转意图)。

---

## 2. 表征层（Representation Layer）—— “数据怎么存”
**核心职责**：管理内容的结构化存储中间态（Intermediate Representation）。它是跨越各种渲染框架的通用语言。
**受众**：本地数据库存储、云端同步模块、导入导出引擎。

*   **2.1 统一内容块 (KRIG-Atom)**
    *   文档内容的最小不可分割单元（Paragraph, MathBlock, CodeBlock）。这是取代传统富文本 HTML/JSON 的核心。
*   **2.2 结构拓扑 (Topology)**
    *   定义 Atom 之间的父子、前后顺序（如 `parentId`, `order`）。
*   **2.3 物理资源表征 (Resource)**
    *   统一的 `media://` 协议定义，抹平本地磁盘图片、网络图片、Base64 的差异。
*   **2.4 容器元数据 (Container Metadata)**
    *   File / Book / Folder 自身的属性信息（大小、创建时间等）。

---

## 3. 渲染层（Visualization Layer）—— “屏幕上画什么”
**核心职责**：为了极致的用户体验和性能，将表征层（Atom）转化为特定 UI 框架能高效消费的数据结构。它允许“脏”和“冗余”，但**绝对不准持久化到数据库**。
**受众**：React 组件、ProseMirror 引擎、ECharts、Three.js。

*   **3.1 框架特定模型 (Framework State)**
    *   `ProseMirror Doc JSON`：仅存在于 Note 插件内存中。
    *   `DOM / React Virtual DOM`：仅存在于组件生命周期中。
*   **3.2 UI 瞬时状态 (Transient UI State)**
    *   当前光标在第几个字符（Selection/Cursor）。
    *   右侧边栏是否展开、哪个文件夹被折叠了（`expandedFolders`）。
    *   **禁忌**：这些状态只能缓存在 LocalStorage 或 L3 的 `pluginStates` 黑盒里，绝不能污染语义层和表征层。
*   **3.3 布局树 (Layout Tree)**
    *   L4 (Slot) 专用的几何数据（Bounds: x, y, width, height）。

---

## 4. 互操作性层（Interoperability Layer）—— “数据怎么流”
**核心职责**：定义上述三层之间、以及不同进程（Main / Renderer）、不同插件之间的数据如何进行翻译和搬运。
**受众**：IPC 通道、API 网关、Converter 转换器。

*   **4.1 转换器契约 (Converters)**
    *   定义表征层与渲染层的双向翻译法则（如 `Atom <-> ProseMirror JSON`）。
    *   定义外部数据到表征层的清洗法则（如 `Web DOM <-> ExtractedBlock <-> Atom`）。
*   **4.2 通信协议 (Message Protocol)**
    *   进程间的标准指令格式（Payload Type）。
    *   **原则**：通信协议只允许传输“表征层（Atom）”或“语义层（Intent）”的数据，绝不允许在 IPC 里传输包含 DOM 节点或回调函数的“渲染层数据”。
*   **4.3 同步契约 (Sync Protocol)**
    *   与云端 OBox / 其它 KRIG 客户端互通时的 CRDT / 差异补丁（Diff Patch）数据结构。

---

## 结论与规范落地

当你按照这四大层级重新审视数据模型时，所有的界线将变得无比清晰：

1. **如果你在写数据库 Schema**：你只能使用【第1层】和【第2层】的数据类型。
2. **如果你在写 L5 的 React 组件**：你只能使用【第3层】的数据，但当你点击“保存”时，必须调用【第4层】的转换器，把它变成【第2层】再发出去。
3. **如果你在写 L3 的工作空间**：你的职责是管理【第3层】的容器实例，并路由【第4层】的消息。

我们完全可以基于这四个分类，在 `src/shared/types/` 下重新组织类型定义文件，将其从现在的“一锅粥”拆分为语义明确的域模型。
