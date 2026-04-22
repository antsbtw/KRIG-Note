/**
 * Note 编辑器类型定义
 *
 * 三基类架构：TextBlock / RenderBlock / ContainerBlock
 */

import type { NodeSpec, MarkSpec } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { AtomConverter } from './converters/converter-types';
type Command = (state: import('prosemirror-state').EditorState, dispatch?: (tr: import('prosemirror-state').Transaction) => void, view?: import('prosemirror-view').EditorView) => boolean;

// ── NodeView ──

export type NodeViewFactory = (
  node: PMNode,
  view: EditorView,
  getPos: () => number | undefined,
) => {
  dom: HTMLElement;
  contentDOM?: HTMLElement;
  update?: (node: PMNode) => boolean;
  selectNode?: () => void;
  deselectNode?: () => void;
  stopEvent?: (event: Event) => boolean;
  ignoreMutation?: (mutation: MutationRecord) => boolean;
  destroy?: () => void;
};

// ── Block 能力声明 ──

export interface BlockCapabilities {
  turnInto?: string[];         // 可转换的目标类型
  marks?: string[];            // 支持的 mark 类型
  canDuplicate?: boolean;
  canDelete?: boolean;
  canDrag?: boolean;

  /**
   * 级联删除边界：该 block 作为"结构骨架"类型，
   *   - content 表达式不是泛 `block+`，而是受限的特定子类型（如 `tableRow+` / `column+` / `block+` 但 cell 必须非空）
   *   - 删除它的子节点时，不应通过"级联删空容器"把它本身当成普通容器删掉
   *
   * deleteBlockAt / cascadeDeleteAtChild 遇到这种父容器时停止向上级联；
   * deleteBlockAt 对这种容器的"唯一子"还会拒绝删除（cell 不能变空）。
   *
   * 目前声明此标志的：table / tableRow / tableCell / tableHeader / column / columnList
   */
  cascadeBoundary?: boolean;
}

// ── Container 规则 ──

export interface ContainerRule {
  requiredFirstChildType?: string;  // 必填首子节点类型
}

// ── Enter 行为声明 ──

export interface EnterBehavior {
  action: 'split' | 'newline' | 'exit';
  exitCondition: 'empty-enter' | 'double-enter' | 'always';
}

// ── SlashMenu 定义 ──

export interface SlashMenuDef {
  label: string;
  icon: string;
  group: string;
  keywords: string[];
  order: number;
}

// ── HandleMenu 自定义操作 ──

export interface ActionDef {
  id: string;
  label: string;
  icon: string;
  handler: (view: EditorView, pos: number) => boolean;
  showIn?: ('handleMenu' | 'contextMenu')[];
}

// ── Block 定义（所有 Block 的注册接口） ──

export interface BlockDef {
  name: string;
  group: 'block' | 'inline' | '';

  nodeSpec: NodeSpec;
  nodeView?: NodeViewFactory;

  capabilities: BlockCapabilities;
  customActions?: ActionDef[];

  slashMenu?: SlashMenuDef | null;
  shortcuts?: Record<string, Command>;

  enterBehavior?: EnterBehavior;
  onIndent?: (view: EditorView, pos: number) => boolean;
  onOutdent?: (view: EditorView, pos: number) => boolean;

  plugin?: () => Plugin | Plugin[];
  containerRule?: ContainerRule;

  // ── 数据层 ──
  converter?: AtomConverter;    // Atom ↔ ProseMirror 转换器
}

// ── SlashMenu 注册项（用于 heading 等 attrs 变体） ──

export interface SlashItemDef {
  id: string;
  blockName: string;
  label: string;
  icon: string;
  group: string;
  keywords: string[];
  order: number;
  attrs?: Record<string, unknown>;
}
