/**
 * 表征层 Schema (Representation Layer)
 * 
 * 职能：持久化存储（DB、本地磁盘）的标准结构、跨平台的“世界语”。
 * 包含 Atom 内容块、Web 提取物中间态、图谱持久化格式等。
 */

import type { Provenance } from './schema-semantic';
/**
 * KRIG Atom 类型定义
 *
 * Atom 是所有内容来源的统一中间表示：框架无关、类型完整、来源可追溯。
 * 覆盖 Note 编辑器、PDF 导入、Web 提取、AI 对话提取。
 *
 * 设计文档：docs/Ai-Design/KRIG-Atom体系设计文档.md
 */

// ═══════════════════════════════════════════════════════
// §1  Atom 核心接口
// ═══════════════════════════════════════════════════════

export interface Atom {
  id: string;
  type: AtomType;
  content: AtomContent;

  // 结构关系（扁平存储，不嵌套）
  parentId?: string;
  order?: number;

  // 知识关系
  links?: string[];

  // 来源追溯（一等字段）
  from?: Provenance;

  // Block 框定（通用视觉能力，跨所有 block 类型）
  frame?: { color: string; style: string; groupId: string | null; thoughtId?: string | null };

  meta: AtomMeta;
}

export interface AtomMeta {
  createdAt: number;
  updatedAt: number;
  nodeIds?: string[];
  dirty: boolean;
}

// ═══════════════════════════════════════════════════════
// §2  Provenance — 来源追溯
// ═══════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════
// §3  AtomType 枚举
// ═══════════════════════════════════════════════════════

// ── 文本流 ──
export type TextAtomType =
  | 'paragraph'
  | 'heading'
  | 'noteTitle';

// ── 容器 ──
export type ContainerAtomType =
  | 'bulletList'
  | 'orderedList'
  | 'listItem'
  | 'taskList'
  | 'taskItem'
  | 'blockquote'
  | 'callout'
  | 'toggleList'
  | 'toggleItem'
  | 'frameBlock'
  | 'table'
  | 'tableRow'
  | 'tableCell'
  | 'tableHeader'
  | 'columnList'
  | 'column';

// ── 渲染块 ──
export type RenderAtomType =
  | 'codeBlock'
  | 'mathBlock'
  | 'mathVisual'
  | 'image'
  | 'figure'
  | 'video'
  | 'audio'
  | 'tweet'
  | 'fileBlock'      // 附件 — AI/user 自包含资产，字节存在 media store
  | 'externalRef'    // 外部引用 — 对本机路径或网络 URL 的指向（不复制字节）
  | 'htmlBlock';     // HTML 预览 — sandbox iframe 渲染 AI 生成的 HTML artifact

// ── 特殊 ──
export type SpecialAtomType =
  | 'horizontalRule'
  | 'hardBreak'
  | 'document'
  | 'pageAnchor';

// ── 完整联合类型 ──
export type AtomType =
  | TextAtomType
  | ContainerAtomType
  | RenderAtomType
  | SpecialAtomType;

// ═══════════════════════════════════════════════════════
// §4  AtomContent — 各类型的精确内容结构
// ═══════════════════════════════════════════════════════

// ── 4.1 文本流 ──

export interface ParagraphContent {
  children: InlineElement[];
  textIndent?: boolean;
  indent?: number;
  align?: 'left' | 'center' | 'right';
}

export interface HeadingContent {
  level: 1 | 2 | 3;
  children: InlineElement[];
  textIndent?: boolean;
  indent?: number;
  align?: 'left' | 'center' | 'right';
}

export interface NoteTitleContent {
  children: InlineElement[];
}

// ── 4.2 容器 ──

export interface ListContent {
  listType: 'bullet' | 'ordered' | 'task';
  start?: number;
}

export interface ListItemContent {
  checked?: boolean;
  /** taskItem：创建时间（ISO string） */
  createdAt?: string;
  /** taskItem：完成时间（ISO string），勾选后写入 */
  completedAt?: string;
  /** taskItem：截止时间（ISO string） */
  deadline?: string;
  /**
   * @deprecated 旧数据兼容字段：
   *   - taskItem 历史实现把第一个子 textBlock 的 inline 抽出来存这里 → 导致 cell/taskItem 内
   *     非 textBlock 的子 block（如嵌套 bulletList / image）在持久化后丢失。
   *   - listItem 是 markdown 导入的 compat atom（schema 无此节点），toPM 会把它展平成 textBlock，
   *     仍沿用此字段。
   *
   * 新数据下 taskItem 子 block 走"子 Atom + parentId"层级，不再内嵌。
   * 读时兼容（toPM 发现字段非空 → 吐 textBlock 包裹 inline），再次保存会自动升级为新格式。
   */
  children?: InlineElement[];
}

export interface BlockquoteContent {
  children: InlineElement[];
  citation?: string;
}

export interface CalloutContent {
  calloutType: 'info' | 'warning' | 'tip' | 'danger' | 'note';
  emoji?: string;
  title?: string;
}

export interface ToggleListContent {
  open: boolean;
  title: string;
}

export interface FrameBlockContent {
  label?: string;
}

export interface TableContent {
  colCount: number;
}

export interface TableCellContent {
  colspan?: number;
  rowspan?: number;
  isHeader?: boolean;
  /** 单元格文字对齐：'left' | 'center' | 'right' | 'justify'。null/缺省 = 继承默认 */
  align?: 'left' | 'center' | 'right' | 'justify' | null;
  /**
   * @deprecated 旧数据兼容字段。新数据 cell 的内容走 parentId 层级，
   * 不再内嵌 children。读时兼容 + 再次保存自动升级为子 Atom 结构。
   */
  children?: InlineElement[];
}

export interface ColumnListContent {
  columns: number;
}

// ── 4.3 渲染块 ──

export interface CodeBlockContent {
  code: string;
  language: string;
  title?: string;      // 可选标题（如 ChatGPT Canvas 标题）
}


export interface MathBlockContent {
  latex: string;
  color?: string;
  bgColor?: string;
}

export interface MathVisualContent {
  title?: string;
  functions: Record<string, unknown>[];
  domain: [number, number];
  range: [number, number];
  parameters: Record<string, unknown>[];
  annotations: Record<string, unknown>[];
  canvas?: Record<string, unknown>;
  tangentLines?: Record<string, unknown>[];
  normalLines?: Record<string, unknown>[];
  integralRegions?: Record<string, unknown>[];
  featurePoints?: Record<string, unknown>[];
}

export interface ImageContent {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  caption?: string;
  originalSrc?: string;
  mediaId?: string;
}

export interface FigureContent {
  src: string;
  caption?: string;
  figureType?: 'chart' | 'diagram' | 'photo' | 'unknown';
}

export interface VideoContent {
  src: string;
  title?: string;
  embedType?: 'youtube' | 'vimeo' | 'direct';
  poster?: string;
  duration?: number;
}

export interface AudioContent {
  src: string;
  title?: string;
  mimeType?: string;
  duration?: number;
}

/**
 * A generic attachment — a file whose bytes live inside the KRIG media
 * store. Used for AI-generated outputs (Canvas source, Code Interpreter
 * .csv/.xlsx, Deep Research PDFs) and user uploads. `src` is a
 * `media://files/...` URL that renders through the registered protocol.
 */
export interface FileBlockContent {
  /** Media store id (from mediaSurrealStore.putBase64 or similar). */
  mediaId: string;
  /** `media://files/{filename}` — directly usable as href. */
  src: string;
  /** Display name (with extension). */
  filename: string;
  /** Original MIME type, e.g. `application/pdf`. */
  mimeType: string;
  /** Size in bytes; optional when unknown. */
  size?: number;
  /** Optional: where this attachment came from. */
  source?: 'ai-generated' | 'user-uploaded' | 'krig-attached';
}

/**
 * An external reference — a pointer to something outside KRIG's storage
 * (local disk file or web URL). Unlike FileBlock we do NOT copy bytes;
 * KRIG only stores the URI. This lets the user treat external resources
 * as first-class knowledge nodes for future Graph queries like
 * "which notes reference this PDF" without bloating the note body.
 *
 * The `href` is always a URI: `file:///absolute/path` for local files
 * or `https://...` for web URLs. Renderer code splits on `kind` to
 * decide how to open (shell.openPath vs shell.openExternal).
 */
export interface ExternalRefContent {
  kind: 'file' | 'url';
  /** URI — `file:///...` for kind=file, `https://...` for kind=url. */
  href: string;
  /** Display label shown in the card; defaults to filename or host. */
  title?: string;
  /** Optional metadata (populated opportunistically by the caller). */
  mimeType?: string;
  size?: number;
  modifiedAt?: number;
}

export interface HtmlBlockContent {
  src: string;
  title?: string;
  height?: number;
  caption?: string;
}

export interface TweetContent {
  tweetUrl: string;
  tweetId?: string;
  author?: { name: string; handle: string; avatar?: string };
  text?: string;
  createdAt?: string;
  media?: Array<{ type: 'image' | 'video'; url: string }>;
}

// ── 4.5 页面锚点 ──

export interface PageAnchorContent {
  pdfPage: number;
  label?: string;  // 如 "第 20 页"
}

// ── 4.6 完整联合类型 ──

export type AtomContent =
  | ParagraphContent
  | HeadingContent
  | NoteTitleContent
  | ListContent
  | ListItemContent
  | BlockquoteContent
  | CalloutContent
  | ToggleListContent
  | FrameBlockContent
  | TableContent
  | TableCellContent
  | ColumnListContent
  | CodeBlockContent
  | MathBlockContent
  | MathVisualContent
  | ImageContent
  | FigureContent
  | VideoContent
  | AudioContent
  | TweetContent
  | FileBlockContent
  | ExternalRefContent
  | HtmlBlockContent
  | PageAnchorContent;

// ═══════════════════════════════════════════════════════
// §5  InlineElement + Mark
// ═══════════════════════════════════════════════════════

export type InlineElement =
  | TextNode
  | MathInline
  | CodeInline
  | LinkNode
  | NoteLinkNode
  | FileLinkNode
  | MentionNode;

export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[];
}

export interface MathInline {
  type: 'math-inline';
  latex: string;
}

export interface CodeInline {
  type: 'code-inline';
  code: string;
}

export interface LinkNode {
  type: 'link';
  href: string;
  title?: string;
  children: TextNode[];
}

export interface NoteLinkNode {
  type: 'note-link';
  noteId: string;
  title: string;
}

export interface FileLinkNode {
  type: 'file-link';
  src: string;       // media://files/...
  filename: string;  // 显示名
}

export interface MentionNode {
  type: 'mention';
  targetId: string;
  label: string;
}

export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'highlight'; color?: string }
  | { type: 'textStyle'; color?: string }
  | { type: 'thought'; thoughtId: string; thoughtType?: string; anchorType?: string };

// ═══════════════════════════════════════════════════════
// §6  工具函数
// ═══════════════════════════════════════════════════════

let atomCounter = 0;

export function generateAtomId(): string {
  return `atom-${Date.now()}-${++atomCounter}`;
}

export function createAtom(
  type: AtomType,
  content: AtomContent,
  parentId?: string,
): Atom {
  const now = Date.now();
  return {
    id: generateAtomId(),
    type,
    content,
    parentId,
    meta: {
      createdAt: now,
      updatedAt: now,
      dirty: true,
    },
  };
}


// ── Extraction Types ──

/**
 * 提取流水线共享类型
 *
 * ExtractedBlock — AI 回复解析 / Web 内容提取的统一中间格式
 * 被 ResultParser、blocks-to-pm-nodes、content-to-atoms 等模块共用。
 *
 * Ported from mirro-desktop's shared/types/extraction-types.ts (verified).
 * Design doc: docs/web/WebBridge-设计.md §六
 */

export interface ExtractedInline {
  type: 'text' | 'link' | 'math-inline' | 'code-inline' | 'bold' | 'italic' | 'file-link';
  text: string;
  href?: string;  // for 'link' and 'file-link' (media:// URL)
}

export interface ExtractedListItem {
  text: string;
  inlines?: ExtractedInline[];
  blocks?: ExtractedBlock[];
}

export interface ExtractedBlock {
  type: 'paragraph' | 'heading' | 'blockquote' | 'callout' | 'code' | 'math' | 'image' | 'video' | 'audio' | 'bulletList' | 'orderedList' | 'table' | 'file' | 'htmlBlock';
  tag: string;
  text: string;
  headingLevel: number;
  src?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  alt?: string;
  width?: number;
  height?: number;
  items?: ExtractedListItem[];
  inlines?: ExtractedInline[];
  caption?: string;
  pageRef?: number;
  bbox?: { x: number; y: number; w: number; h: number };
  tableRows?: string[][];
  tableHasHeader?: boolean;
  poster?: string;
  description?: string;
  author?: string;
  publishedAt?: string;
  duration?: number;
  domain?: string;
  transcript?: string;
  language?: string;
  calloutType?: string;
  calloutEmoji?: string;
  codeTitle?: string;       // 带标题的代码块（Canvas 等场景）
}


// ── Graph Types ──

/**
 * Graph 画板类型定义(shared)
 *
 * 一个 GraphCanvasRecord 是一篇画板,doc_content 存的是 Canvas Document JSON
 * (详见 docs/graph/canvas/Canvas.md §4.1 + src/plugins/graph/canvas/persist/serialize.ts)。
 *
 * 与 Note 完全独立 — 自己的表 + 自己的 store + 自己的 IPC namespace,
 * 跟 ebook 形态对齐(每个 plugin 自有 store)。
 */

// 画板内容是结构化 JSON(序列化文档),不像 note 是 Atom[]。
// 在 store 层用 unknown 通用,具体形状由 plugins/graph/canvas/persist 决定。
export type CanvasDocumentJson = unknown;

export interface GraphCanvasRecord {
  id: string;
  title: string;
  /** 画板状态(Canvas Document JSON);v1 schema_version=1 */
  doc_content: CanvasDocumentJson;
  /** 画板类型 — v1 仅 'canvas',M2 加 'family-tree' / 'knowledge' / 等 */
  variant: GraphVariant;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}

export type GraphVariant = 'canvas' | 'family-tree' | 'knowledge' | 'mindmap';

export interface GraphCanvasListItem {
  id: string;
  title: string;
  variant: GraphVariant;
  folder_id: string | null;
  updated_at: number;
}

/** 画板文件夹(独立表 graph_folder,不与 note folder 共享) */
export interface GraphFolderRecord {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

// ── Store 接口 ──

export interface IGraphStore {
  create(title: string, variant: GraphVariant, folderId?: string | null): Promise<GraphCanvasRecord>;
  get(id: string): Promise<GraphCanvasRecord | null>;
  save(id: string, docContent: CanvasDocumentJson, title: string): Promise<void>;
  delete(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  duplicate(id: string, targetFolderId?: string | null): Promise<GraphCanvasRecord | null>;
  list(): Promise<GraphCanvasListItem[]>;
}

export interface IGraphFolderStore {
  create(title: string, parentId?: string | null): Promise<GraphFolderRecord>;
  rename(id: string, title: string): Promise<void>;
  delete(id: string): Promise<void>;
  move(id: string, parentId: string | null): Promise<void>;
  list(): Promise<GraphFolderRecord[]>;
}
