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
  canIndent?: boolean;
  canDuplicate?: boolean;
  canDelete?: boolean;
  canColor?: boolean;
  canDrag?: boolean;
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

// ── BlockDef — 一站式注册 ──

export interface BlockDef {
  name: string;
  group: 'block' | 'inline';
  nodeSpec: NodeSpec;
  nodeView?: NodeViewFactory;
  tabs?: TabDefinition[];
  converter?: AtomConverter;
  capabilities: BlockCapabilities;
  customActions?: ActionDef[];
  slashMenu?: SlashMenuDef | null;
  shortcuts?: Record<string, Command>;
  plugin?: () => Plugin;
  containerRule?: ContainerRule;
}
