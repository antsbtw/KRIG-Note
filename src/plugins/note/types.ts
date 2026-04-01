import type { NodeSpec, Schema, Plugin, Command } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';

/**
 * NoteView 核心类型定义
 */

// ── NodeView 工厂 ──

export type NodeViewFactory = (
  node: import('prosemirror-model').Node,
  view: EditorView,
  getPos: () => number | undefined,
) => NodeView;

// ── Block 能力声明 ──

export interface BlockCapabilities {
  turnInto?: string[];
  marks?: string[];
  canDuplicate?: boolean;
  canDelete?: boolean;
  canColor?: boolean;
  canDrag?: boolean;
  // canIndent 已移除——所有 Block 默认支持缩进
}

// ── SlashMenu 定义 ──

export interface SlashMenuDef {
  label: string;
  icon?: string;
  group: string;
  keywords?: string[];
  order?: number;
}

// ── Tab 定义 ──

export interface TabDefinition {
  id: string;
  label: string;
  type: 'rendered' | 'editable';
  defaultVisible?: boolean;
}

// ── 容器规则 ──

export interface ContainerRule {
  requiredFirstChildType?: string;
  convertTo?: string;
}

// ── Block 专有操作 ──

export interface ActionDef {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  handler: (view: EditorView, pos: number) => boolean;
  showIn?: ('handleMenu' | 'contextMenu' | 'toolbar')[];
}

// ── Atom Converter ──

export interface AtomConverter {
  atomType: string;
  pmType: string;
  atomToPM(atom: Atom): PMNodeJSON;
  pmToAtom(node: PMNodeJSON, parentId: string): Atom;
}

export interface Atom {
  id: string;
  type: string;
  content: Record<string, unknown>;
  parentId?: string;
  meta?: Record<string, unknown>;
}

export interface PMNodeJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNodeJSON[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

// ── Enter 行为声明 ──

export interface EnterBehavior {
  /** Enter 按下时的动作 */
  action: 'split' | 'newline' | 'exit';
  // split:    分裂为两个同类型 Block（默认行为）
  // newline:  在 Block 内部换行（如 codeBlock）
  // exit:     直接退出到下方 paragraph（如 noteTitle）

  /** 退出条件（action 为 split 或 newline 时，如何退出回到 paragraph） */
  exitCondition?: 'empty-enter' | 'double-enter' | 'always';
  // empty-enter:   空内容时按 Enter 退出（如 listItem、blockquote）
  // double-enter:  连按两次 Enter 退出（如 codeBlock）
  // always:        每次 Enter 都退出（如 noteTitle）
}

// ── BlockDef — 一站式注册 ──

export interface BlockDef {
  name: string;
  group: 'block' | 'inline' | '';   // 空字符串 = 不属于任何组（如 noteTitle、listItem）
  nodeSpec: NodeSpec;
  nodeView?: NodeViewFactory;
  tabs?: TabDefinition[];
  converter?: AtomConverter;
  capabilities: BlockCapabilities;
  customActions?: ActionDef[];
  slashMenu?: SlashMenuDef | null;
  shortcuts?: Record<string, Command>;
  enterBehavior?: EnterBehavior;      // Enter 键行为声明（无声明 = 框架默认：split 为 paragraph）
  onIndent?: (view: import('prosemirror-view').EditorView, pos: number) => boolean;   // 缩进附加能力（返回 true = 已处理）
  onOutdent?: (view: import('prosemirror-view').EditorView, pos: number) => boolean;  // 减少缩进附加能力
  plugin?: () => Plugin;              // 仅用于 Enter 之外的特殊键盘处理
  containerRule?: ContainerRule;
}
