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
  from?: FromReference;

  meta: AtomMeta;
}

export interface AtomMeta {
  createdAt: number;
  updatedAt: number;
  nodeIds?: string[];
  dirty: boolean;
}

// ═══════════════════════════════════════════════════════
// §2  FromReference — 来源追溯
// ═══════════════════════════════════════════════════════

export interface FromReference {
  extractionType:
    | 'manual'
    | 'pdf'
    | 'web'
    | 'ai-conversation'
    | 'epub'
    | 'clipboard';

  // PDF 来源
  pdfBookId?: string;
  pdfPage?: number;
  pdfBbox?: { x: number; y: number; w: number; h: number };

  // Web 来源
  url?: string;
  pageTitle?: string;

  // AI 对话来源
  conversationId?: string;
  messageIndex?: number;

  // EPUB 来源
  epubCfi?: string;
  epubBookId?: string;

  // 引用信息（学术场景）
  citation?: {
    title?: string;
    author?: string;
    publisher?: string;
    year?: string;
    page?: string;
    doi?: string;
    accessedAt?: number;
  };

  extractedAt: number;
}

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
  | 'image'
  | 'figure'
  | 'video'
  | 'audio'
  | 'tweet';

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
}

export interface HeadingContent {
  level: 1 | 2 | 3;
  children: InlineElement[];
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
  children: InlineElement[];
  checked?: boolean;
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
  children: InlineElement[];
  colspan?: number;
  rowspan?: number;
  isHeader?: boolean;
}

export interface ColumnListContent {
  columns: number;
}

// ── 4.3 渲染块 ──

export interface CodeBlockContent {
  code: string;
  language: string;
}

export interface MathBlockContent {
  latex: string;
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
  | ImageContent
  | FigureContent
  | VideoContent
  | AudioContent
  | TweetContent
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
  | { type: 'thought'; thoughtId: string };

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
