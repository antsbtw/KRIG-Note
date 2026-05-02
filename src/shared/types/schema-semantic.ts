/**
 * 语义层 Schema (Semantic Layer)
 * 
 * 职能：定义系统认知的抽象实体、关系、溯源。
 * 脱离一切排版和物理存储格式，供大模型、知识图谱引擎、搜索索引使用。
 */

// ── 1. 核心实体与图关系 ──

/** 知识图谱的核心节点（抽象概念实体） */
export interface SemanticNode {
  id: string;                      // 唯一标识 (如 'node:entropy')
  label: string;                   // 实体展示名
  nodeType: 'concept' | 'person' | 'event' | 'thought' | 'unknown';
  aliases?: string[];              // 同义词
  summary?: string;                // AI 提取的单句摘要
  confidence: number;              // 提取可信度 (0.0-1.0)
  createdAt: number;
}

/** 知识图谱的边（三元组关系） */
export interface SemanticTriple {
  sourceId: string;                // 主语 Node ID
  targetId: string;                // 宾语 Node ID
  relation: string;                // 谓语 (如 'IS_A', 'CAUSES', 'MENTIONS')
  provenanceId: string;            // 证据溯源（指向产生该关系的 Atom ID）
}

// ── 2. 数据溯源 (Provenance) ──

/**
 * 终极溯源 (Provenance / 原 FromReference)
 * 任何被存入系统的原子知识，都必须附带此“出生证明”
 */
export interface Provenance {
  extractionType: 'manual' | 'pdf' | 'web' | 'ai-conversation' | 'epub' | 'clipboard';

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

// ── 3. 碎片思考语义 (Thought) ──

export type ThoughtType = 'thought' | 'question' | 'important' | 'todo' | 'analysis' | 'ai-response';

export const THOUGHT_TYPE_META: Record<ThoughtType, { icon: string; color: string; label: string }> = {
  thought:       { icon: '💭', color: '#4a9eff', label: '思考' },
  question:      { icon: '❓', color: '#ff5252', label: '疑问' },
  important:     { icon: '⭐', color: '#ffab40', label: '重要' },
  todo:          { icon: '☐', color: '#4caf50', label: '待办' },
  analysis:      { icon: '🔍', color: '#ab47bc', label: '分析' },
  'ai-response': { icon: '🤖', color: '#6366f1', label: 'AI 回复' },
};

export type AnchorType = 'inline' | 'block' | 'node';

export interface ThoughtRecord {
  id: string;

  // 锚点信息（冗余存储，避免每次查图边）
  anchor_type: AnchorType;
  anchor_text: string;
  anchor_pos: number;

  // 分类与状态
  type: ThoughtType;
  resolved: boolean;
  pinned: boolean;

  // AI 回复专用（type === 'ai-response' 时填充）
  serviceId?: string;    // 'chatgpt' | 'claude' | 'gemini'

  // 内容 (依赖表征层 Atom)
  doc_content: import('./schema-representation').Atom[];

  // 时间戳
  created_at: number;
  updated_at: number;
}

export interface ThoughtListItem {
  id: string;
  type: ThoughtType;
  anchor_type: AnchorType;
  anchor_text: string;
  anchor_pos: number;
  resolved: boolean;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

export interface ThoughtOfEdge {
  anchor_type: AnchorType;
  anchor_pos: number;
  created_at: number;
}
