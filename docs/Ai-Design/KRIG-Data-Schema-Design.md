# KRIG-Note 数据 Schema 具体分类设计 (Data Schema Design)

> **文档目的**：将抽象的数据分层原则转化为可以直接落地为 TypeScript 代码的 **Schema 接口契约**。本设计将指导接下来对 `src/shared/types/` 下庞杂类型体系的重构和拆分。

---

## 1. 语义层 Schema (Semantic Layer)
**目标文件**：`src/shared/types/schema-semantic.ts`
**职责**：脱离具体文件格式，描述知识网络的基础要素和提取溯源。这些类型将直接映射到 SurrealDB 的 Graph Node 和 Edge 表。

```typescript
/** 
 * 1. 语义节点 (Knowledge Node) 
 * 知识图谱中的一个概念、实体或想法。不关心排版。
 */
export interface SemanticNode {
  id: string;                      // 唯一标识 (如 'node:entropy')
  label: string;                   // 实体展示名
  nodeType: 'concept' | 'person' | 'event' | 'thought' | 'unknown';
  aliases?: string[];              // 同义词
  summary?: string;                // AI 提取的单句摘要
  confidence: number;              // 提取可信度 (0.0-1.0)
  createdAt: number;
}

/** 
 * 2. 关系三元组 (Knowledge Triple) 
 * 描述两个 SemanticNode 之间的关系
 */
export interface SemanticTriple {
  sourceId: string;                // 主语 Node ID
  targetId: string;                // 宾语 Node ID
  relation: string;                // 谓语 (如 'IS_A', 'CAUSES', 'MENTIONS')
  provenanceId: string;            // 证据溯源（指向产生该关系的 Atom ID）
}

/** 
 * 3. 终极溯源 (Provenance / FromReference) 
 * 任何被存入系统的原子知识，都必须附带此“出生证明”
 */
export interface Provenance {
  extractionType: 'manual' | 'pdf' | 'web' | 'ai-conversation';
  // PDF 专属定位
  pdfLocation?: { bookId: string; page: number; bbox: number[] };
  // Web 专属定位
  webLocation?: { url: string; title: string };
  // AI 提取定位
  aiLocation?: { conversationId: string; messageIndex: number };
  extractedAt: number;
}
```

---

## 2. 表征层 Schema (Representation Layer)
**目标文件**：`src/shared/types/schema-representation.ts`
**职责**：跨渲染框架的结构化数据（持久化落盘的核心）。这是文件系统和数据库存储的唯一格式。

```typescript
/**
 * 1. 统一原子内容块 (Atom)
 * 取代 ProseMirror JSON 和老旧 HTML 的核心中间件。
 */
export interface Atom {
  id: string;                      // 格式: 'atom:{uuid}'
  type: AtomType;                  // (枚举，如 'paragraph', 'mathBlock', 'table')
  content: AtomContent;            // 内容载体 (对应各种 BlockContent 接口)
  parentId?: string;               // 树状拓扑：指向父级容器 Atom
  order: number;                   // 同级排序索引
  provenance: Provenance;          // 【必填】指向语义层的出生证明
  dirty: boolean;                  // 全文/AI分析索引是否需更新
}

// 具体内容结构示例 (以文本和数学公式为例)
export type AtomType = 'paragraph' | 'mathBlock' | 'image' | 'list';

export type AtomContent = ParagraphContent | MathContent | ImageContent;

export interface ParagraphContent {
  text: string;
  marks: Array<{ type: string; start: number; end: number }>; // 剥离于富文本树的扁平标记
}

export interface MathContent {
  latex: string;
}

/**
 * 2. 物理资源描述符 (Resource)
 */
export interface MediaResource {
  mediaId: string;                 // 'media://{hash}'
  mimeType: string;
  sourceUrl?: string;              // 原始来源 URL
  localPath: string;               // 本地磁盘缓存路径
}
```

---

## 3. 渲染层 Schema (Visualization / UI State)
**目标文件**：`src/shared/types/schema-visualization.ts`
**职责**：运行期为了让 UI 长得好看、交互流畅而产生的脏状态。**这些接口绝对禁止写入到核心数据库。**

```typescript
/**
 * 1. 应用瞬时布局状态 (Layout State)
 * 原本堆在 WorkspaceState 里的“垃圾字段”全部归置于此
 */
export interface AppTransientState {
  // L4 物理槽位几何信息
  slotBounds: {
    left: { x: number, y: number, w: number, h: number };
    right: { x: number, y: number, w: number, h: number } | null;
  };
  // 树形菜单的展开状态（仅缓存于 LocalStorage）
  expandedFolders: string[];
}

/**
 * 2. 各视图插件的私有运行状态 (Plugin View State)
 * L3 (Workspace) 只用泛型 Record<string, PluginViewState> 保存，不关心具体字段。
 */
export interface PluginViewState {
  instanceId: string;
  viewType: 'note' | 'ebook' | 'graph' | 'web';
  // UI 瞬态上下文
  context: {
    activeItemId?: string;         // 如当前打开的 NoteId 或 BookId
    scrollPosition?: number;       // 滚动条高度
    selection?: { start: number, end: number }; // 光标位置
  };
}

/**
 * 3. 框架特有结构 (Framework Bound)
 * (直接复用外部库类型，在此做边界声明)
 */
export type ProseMirrorDoc = any;  // ProseMirror 专有 JSON，绝不离开 NotePlugin
export type EChartsOption = any;   // 图表配置，绝不离开 GraphPlugin
```

---

## 4. 互操作性 Schema (Interoperability Layer)
**目标文件**：`src/shared/types/schema-interop.ts`
**职责**：定义前三者之间如何互相转换，以及 Main / Renderer 进程之间怎么通信。

```typescript
/**
 * 1. 意图调度总线 (Intent Dispatcher)
 * L5 (View) 想开新窗口，只能发送 Intent，由 L3/L4 根据当前布局决定。
 */
export interface BaseIntent {
  action: string;
  sourceViewId: string;            // 谁发起的意图
}

// 意图：我需要查点资料 / 问 AI（不强求开辟右边栏，由框架定夺）
export interface NeedAssistanceIntent extends BaseIntent {
  action: 'intent:need-assistance';
  payload: {
    contextText: string;
    preferredAssistant: 'ai' | 'web-search';
  };
}

// 意图：我打开了一个内容，框架请帮我高亮或者调整导航栏
export interface ContentOpenedIntent extends BaseIntent {
  action: 'intent:content-opened';
  payload: {
    contentType: 'note' | 'ebook';
    contentId: string;
  };
}

/**
 * 2. 跨界转换器契约 (Data Converters)
 * 定义将“渲染层的脏数据”洗成“表征层干净 Atom”的纯函数接口
 */
export interface RepresentationConverter<TRenderData> {
  // 从 UI 状态提取可持久化的 Atom (附带出生证明)
  toAtom(data: TRenderData, provenance: Provenance): Atom[];
  
  // 将底层 Atom 还原回 UI 可读取的状态
  fromAtom(atoms: Atom[]): TRenderData;
}

/**
 * 3. IPC 进程通信标准封包 (IPC Payload)
 * 严格限制 IPC 中只能传递序列化友好的表征层或语义层数据
 */
export interface IpcMessage<T = unknown> {
  channel: string;
  timestamp: number;
  data: T; // T 必须是 SemanticLayer 或 RepresentationLayer 的类型，或者是 Intent
}
```

## 实施落地策略
接下来，我们只需要在 `src/shared/types/` 目录下创建这 4 个拆分后的文件，然后把原本几百行的 `types.ts` 中的接口逐一对号入座、重命名、并修正类型。此时，数据边界就被 TypeScript 的编译期检查给彻底锁死了。
