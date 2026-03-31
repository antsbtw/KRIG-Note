# 存储层 — 定义

> **状态**：蓝图初稿，待讨论完善。
> 定义 KRIG Note 的数据存储架构，包括编辑器数据和知识图谱。

---

## 一、设计原则

1. **接口与实现分离**：定义 IStorage 接口，先用 JSON 文件实现（快速验证），后接 SurrealDB 后端
2. **编辑器数据和知识图谱分层**：编辑器用完整 JSON（性能），知识图谱用三元组（推理）
3. **一生二、二生三、三生万物**：知识图谱只有两种原子——节点（node）和三元组（triple），所有模式从中涌现
4. **异步索引**：编辑保存后异步更新搜索索引和知识图谱，不阻塞编辑体验

---

## 二、两层架构

```
┌─────────────────────────────────────────────────┐
│              应用层（View 插件）                   │
├─────────────────────────────────────────────────┤
│              IStorage 接口层                      │
│  INoteStore / IThoughtStore / IHighlightStore... │
├──────────────────────┬──────────────────────────┤
│   核心存储            │    知识图谱               │
│   （编辑器数据）       │   （推理数据）            │
│                      │                          │
│   note               │    node                  │
│   thought            │    triple                │
│   highlight          │    atom_index            │
│   pdf_book           │                          │
│   folder             │                          │
│   media              │                          │
├──────────────────────┴──────────────────────────┤
│              存储后端                             │
│   Phase 1: JSON 文件    Phase 2: SurrealDB       │
└─────────────────────────────────────────────────┘
```

**核心存储**：服务于编辑器的读写操作，要求快速、完整、原子性。

**知识图谱**：服务于搜索、关联发现、图谱可视化，要求灵活、可推理。

两层通过**异步同步**连接：文档保存 → 异步提取三元组 → 写入知识图谱。

---

## 三、核心存储（编辑器数据）

### 3.1 表清单

| 表 | 职责 | 关键字段 |
|---|---|---|
| `note` | 文档（含完整内容） | title, doc_content, folder_id |
| `thought` | 思考/标注（统一 Note + PDF） | anchor_type, content, note_id, pdf_book_id |
| `highlight` | PDF 文本高亮 | pdf_book_id, page_num, text, rects |
| `pdf_book` | PDF 书架条目 | file_path, page_count, last_page |
| `folder` | 文件夹（Note + PDF 共用） | name, parent_id, folder_type |
| `media` | 媒体资源索引 | original_url, local_path, media_type |

### 3.2 Atom 存储策略：混合模式

**编辑用**：`note.doc_content` 存储完整的 Atom JSON 数组，编辑器直接读写。

```typescript
interface NoteRecord {
  id: string;
  title: string;
  doc_content: Atom[];     // 完整的 Atom 树（编辑器直接用）
  source_url?: string;
  source_type?: string;    // 'web' | 'pdf' | 'markdown' | 'manual'
  folder_id?: string;
  display_order: number;
  created_at: number;
  updated_at: number;
}
```

**查询用**：`atom_index` 表存储 Atom 的纯文本索引，用于全文搜索和知识提取。

```typescript
interface AtomIndexRecord {
  id: string;
  note_id: string;
  type: string;            // Block 类型
  text_content: string;    // 纯文本（搜索用）
  source_pages?: { startPage: number; endPage: number };
}
```

**同步时机**：文档保存后异步更新 `atom_index`。编辑器不等待索引完成。

### 3.3 Thought 统一存储

解决 mirro-desktop 的分裂存储（Note Thought 在 document JSON，PDF Thought 在 highlights.json）。

```typescript
interface ThoughtRecord {
  id: string;

  // 锚定信息
  anchor_type: 'inline' | 'block' | 'node' | 'pdf';
  anchor_id?: string;
  anchor_text?: string;
  anchor_pos?: number;

  // 来源（二选一）
  note_id?: string;
  pdf_book_id?: string;
  highlight_id?: string;

  // 内容
  type: 'thought' | 'question' | 'important' | 'todo' | 'analysis';
  content: Atom[];         // 完整 Block 流文档
  resolved: boolean;
  pinned: boolean;
  collapsed: boolean;

  created_at: number;
  updated_at: number;
}
```

无论来源是 Note 还是 PDF，所有 Thought 在同一个表中，可以统一查询。

---

## 四、知识图谱（推理数据）

### 4.1 核心思想：一生二、二生三、三生万物

知识图谱只有两种原子：

- **节点（node）**：知识的基本粒子——任何事物、概念、实体
- **三元组（triple）**：节点之间的关系——(主体, 关系, 客体)

不预定义关系类型枚举。"人事物时空"不是硬编码的分类，而是从大量三元组中**涌现**的模式。

```
一（node）      → 知识的基本粒子
二（node + triple）→ 有了关系，产生了连接
三（推理模型）    → 从三元组中推导出新的三元组、分类、模式
万物（知识图谱）  → 人事物时空自然涌现
```

### 4.2 Node — 知识节点

```typescript
interface KnowledgeNode {
  id: string;
  name: string;              // 节点名称
  type?: string;             // 可选标签（由推理模型填充，如 'person', 'concept', 'event'）
  properties?: Record<string, unknown>;  // 任意属性（JSON）
  created_at: number;
}
```

不区分 concept 和 entity——统一为 node。type 字段是可选的、可变的，由推理模型根据三元组模式自动分类。

### 4.3 Triple — 三元组

```typescript
interface KnowledgeTriple {
  id: string;
  subject: string;           // 主体节点 ID
  predicate: string;         // 关系（自由文本，如 "发明了"、"属于"、"影响了"）
  object: string;            // 客体节点 ID
  source?: string;           // 来源（哪个 note/atom 提取的）
  confidence: number;        // 置信度（AI 提取时，0.0-1.0）
  created_at: number;
}
```

`predicate` 是自由文本，不是枚举。系统不限制关系的种类——"创办了"、"位于"、"发生在 2024 年"、"属于机器学习领域"——都是合法的 predicate。

### 4.4 五维涌现

"人、事、物、时、空"不需要硬编码，它们从三元组模式中涌现：

| 维度 | 涌现方式 |
|------|---------|
| **人（Who）** | 节点的 predicate 大量是 "创办了"、"发明了"、"撰写了" → 推理为"人" |
| **事（What）** | 节点的 predicate 大量是 "引起了"、"导致了" → 推理为"事件" |
| **物（Object）** | 节点的 predicate 大量是 "属于"、"包含"、"实现了" → 推理为"物/概念" |
| **时（When）** | predicate 包含时间语义（"发生在"、"截止于"）→ 推理为时间维度 |
| **空（Where）** | predicate 包含空间语义（"位于"、"来源于"）→ 推理为空间维度 |

推理模型定期扫描三元组，自动填充 `node.type` 和发现新的关联模式。

### 4.5 SurrealDB 实现（Phase 2）

```sql
-- 知识节点
DEFINE TABLE node SCHEMAFULL;
DEFINE FIELD name       ON node TYPE string;
DEFINE FIELD type       ON node TYPE option<string>;
DEFINE FIELD properties ON node TYPE option<object>;
DEFINE FIELD created_at ON node TYPE datetime DEFAULT time::now();

DEFINE INDEX node_name ON node FIELDS name;
DEFINE INDEX node_type ON node FIELDS type;
DEFINE INDEX node_search ON node FIELDS name SEARCH ANALYZER note_analyzer;

-- 三元组（Graph Edge）
DEFINE TABLE triple SCHEMAFULL;
DEFINE FIELD in         ON triple TYPE record<node>;      -- 主体
DEFINE FIELD out        ON triple TYPE record<node>;      -- 客体
DEFINE FIELD predicate  ON triple TYPE string;             -- 关系
DEFINE FIELD source     ON triple TYPE option<record>;     -- 来源
DEFINE FIELD confidence ON triple TYPE float DEFAULT 1.0;
DEFINE FIELD created_at ON triple TYPE datetime DEFAULT time::now();

DEFINE INDEX triple_predicate ON triple FIELDS predicate;
DEFINE INDEX triple_source ON triple FIELDS source;
```

### 4.6 典型查询

```sql
-- 某节点的所有关系
SELECT ->triple->node as targets, <-triple<-node as sources FROM node:ml;

-- 某节点关联的所有文档（通过 source 追溯）
SELECT source FROM triple WHERE in = node:ml OR out = node:ml;

-- 两个节点之间的关系路径（2 跳）
SELECT ->triple->node->triple->node FROM node:a WHERE out = node:b;

-- 所有"人"类型的节点
SELECT * FROM node WHERE type = 'person';

-- 知识图谱可视化数据
SELECT id, name, type FROM node;
SELECT in.id as source, out.id as target, predicate FROM triple;
```

---

## 五、IStorage 接口层

### 5.1 接口定义

```typescript
/** Note 存储接口 */
interface INoteStore {
  create(note: Partial<NoteRecord>): Promise<NoteRecord>;
  get(id: string): Promise<NoteRecord | null>;
  update(id: string, partial: Partial<NoteRecord>): Promise<void>;
  delete(id: string): Promise<void>;
  list(folderId?: string): Promise<NoteRecord[]>;
  search(query: string): Promise<NoteRecord[]>;
}

/** Thought 存储接口（统一 Note + PDF） */
interface IThoughtStore {
  create(thought: Partial<ThoughtRecord>): Promise<ThoughtRecord>;
  getByNote(noteId: string): Promise<ThoughtRecord[]>;
  getByPDF(pdfBookId: string): Promise<ThoughtRecord[]>;
  update(id: string, partial: Partial<ThoughtRecord>): Promise<void>;
  delete(id: string): Promise<void>;
}

/** 知识图谱接口 */
interface IKnowledgeStore {
  addNode(node: Partial<KnowledgeNode>): Promise<KnowledgeNode>;
  addTriple(triple: Partial<KnowledgeTriple>): Promise<KnowledgeTriple>;
  getNode(id: string): Promise<KnowledgeNode | null>;
  findNodes(query: string): Promise<KnowledgeNode[]>;
  getRelations(nodeId: string): Promise<KnowledgeTriple[]>;
  getGraphData(): Promise<{ nodes: KnowledgeNode[]; triples: KnowledgeTriple[] }>;
}
```

### 5.2 实现计划

| Phase | 存储后端 | 特点 |
|-------|---------|------|
| **Phase 1** | JSON 文件 | 简单、快速验证功能，每个 store 一个 JSON 文件 |
| **Phase 2** | SurrealDB | 嵌入式（RocksDB），全文搜索、图遍历、事务 |

Phase 1 到 Phase 2 的切换只需要替换 IStorage 的实现，上层代码不变。

---

## 六、数据流

### 6.1 编辑器数据流

```
用户编辑 NoteView
  → ProseMirror Doc 变更
  → 转为 Atom[] JSON
  → INoteStore.update(noteId, { doc_content: atoms })
  → 异步：提取纯文本 → 更新 atom_index
  → 异步：AI 提取三元组 → 更新 node + triple
```

### 6.2 知识图谱构建流

```
文档保存（触发异步）
  → 提取文本内容
  → AI 分析：识别实体和关系
  → 生成三元组：(subject, predicate, object)
  → 查找或创建 node
  → 写入 triple（关联 source 到原始 note/atom）
  → 推理模型：扫描三元组模式 → 更新 node.type
```

### 6.3 GraphView 数据流

```
GraphView 请求可视化数据
  → IKnowledgeStore.getGraphData()
  → 返回 { nodes, triples }
  → GraphView 渲染节点和边
  → 用户点击节点 → 通过 source 追溯到原始文档
```

---

## 七、约束

1. **接口优先**：所有数据访问通过 IStorage 接口，不直接操作存储后端
2. **编辑不等索引**：文档保存是同步的，索引更新是异步的。编辑器永远不被索引阻塞
3. **三元组自由**：predicate 是自由文本，系统不限制关系类型的种类
4. **来源可追溯**：每个三元组记录来源（source），可以追溯到原始的 note/atom
5. **推理可选**：知识图谱的推理（node.type 分类、模式发现）是增值能力，不是必需的。没有推理模型时，图谱仍然可用（手动标注 + 原始三元组）
