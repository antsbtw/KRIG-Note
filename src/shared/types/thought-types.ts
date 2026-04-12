/**
 * Thought 类型定义
 *
 * Thought 是附着于主文档锚点的完整思考文档。
 * 通过 SurrealDB 图关系 (thought_of) 与 Note 关联。
 */

import type { Atom } from './atom-types';

// ── 语义分类 ──

export type ThoughtType = 'thought' | 'question' | 'important' | 'todo' | 'analysis';

export const THOUGHT_TYPE_META: Record<ThoughtType, { icon: string; color: string; label: string }> = {
  thought:   { icon: '💭', color: '#4a9eff', label: '思考' },
  question:  { icon: '❓', color: '#ff5252', label: '疑问' },
  important: { icon: '⭐', color: '#ffab40', label: '重要' },
  todo:      { icon: '☐', color: '#4caf50', label: '待办' },
  analysis:  { icon: '🔍', color: '#ab47bc', label: '分析' },
};

// ── 锚点类型 ──

export type AnchorType = 'inline' | 'block' | 'node';

// ── Thought 数据记录 ──

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

  // 内容
  doc_content: Atom[];

  // 时间戳
  created_at: number;
  updated_at: number;
}

// ── 列表摘要 ──

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

// ── Store 接口 ──

export interface IThoughtStore {
  create(thought: Omit<ThoughtRecord, 'id' | 'created_at' | 'updated_at'>): Promise<ThoughtRecord>;
  get(id: string): Promise<ThoughtRecord | null>;
  save(id: string, updates: Partial<ThoughtRecord>): Promise<void>;
  delete(id: string): Promise<void>;
  listByNote(noteId: string): Promise<ThoughtRecord[]>;
}

// ── 图关系边属性 ──

export interface ThoughtOfEdge {
  anchor_type: AnchorType;
  anchor_pos: number;
  created_at: number;
}
