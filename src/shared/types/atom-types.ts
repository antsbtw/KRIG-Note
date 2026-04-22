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
  align?: 'left' | 'center' | 'right';
}

export interface HeadingContent {
  level: 1 | 2 | 3;
  children: InlineElement[];
  textIndent?: boolean;
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
