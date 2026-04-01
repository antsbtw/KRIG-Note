import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { blockRegistry } from '../registry';
import { blockSelectionKey } from './block-selection';

/**
 * Block Action — Block 级操作层
 *
 * 统一管理所有 Block 级操作。
 * 菜单组件只调用 blockAction.xxx()，不直接操作 ProseMirror。
 * 每个操作执行前检查 Block 的 capabilities。
 */

// ── Block 内部剪贴板（支持多 Block） ──
let blockClipboard: { json: unknown }[] | null = null;

export const blockAction = {
  // ── 删除 ──

  delete(view: EditorView, pos: number): boolean {
    const node = view.state.doc.nodeAt(pos);
    if (!node) return false;

    const blockDef = blockRegistry.get(node.type.name);
    if (blockDef && blockDef.capabilities.canDelete === false) return false;

    const tr = view.state.tr.delete(pos, pos + node.nodeSize);
    view.dispatch(tr);
    view.focus();
    return true;
  },

  deleteSelected(view: EditorView): boolean {
    const state = blockSelectionKey.getState(view.state);
    if (!state?.active || state.positions.length === 0) return false;

    const sorted = [...state.positions].sort((a, b) => b - a);
    let tr = view.state.tr;

    for (const pos of sorted) {
      const node = tr.doc.nodeAt(pos);
      if (!node) continue;
      const blockDef = blockRegistry.get(node.type.name);
      if (blockDef && blockDef.capabilities.canDelete === false) continue;
      tr = tr.delete(pos, pos + node.nodeSize);
    }

    tr.setMeta(blockSelectionKey, { clear: true });
    view.dispatch(tr);
    view.focus();
    return true;
  },

  // ── 剪切（Block 级） ──

  cut(view: EditorView): boolean {
    if (!this.copy(view)) return false;
    this.deleteSelected(view);
    return true;
  },

  // ── 复制（Block 级，支持多选） ──

  copy(view: EditorView): boolean {
    const state = blockSelectionKey.getState(view.state);
    if (!state?.active || state.positions.length === 0) return false;

    const items: { json: unknown }[] = [];
    const sorted = [...state.positions].sort((a, b) => a - b);

    for (const pos of sorted) {
      const node = view.state.doc.nodeAt(pos);
      if (node) {
        items.push({ json: node.toJSON() });
      }
    }

    if (items.length > 0) {
      blockClipboard = items;
      return true;
    }
    return false;
  },

  // ── 粘贴（Block 级） ──

  paste(view: EditorView, pos: number): boolean {
    if (!blockClipboard || blockClipboard.length === 0) return false;

    try {
      let tr = view.state.tr;
      let insertPos = pos;

      for (const item of blockClipboard) {
        const node = PMNode.fromJSON(view.state.schema, item.json as Record<string, unknown>);
        tr = tr.insert(insertPos, node);
        insertPos += node.nodeSize;
      }

      view.dispatch(tr);
      view.focus();
      return true;
    } catch {
      return false;
    }
  },

  hasClipboard(): boolean {
    return blockClipboard !== null && blockClipboard.length > 0;
  },

  // ── 移动（Handle 拖拽） ──

  move(view: EditorView, fromPos: number, toPos: number): boolean {
    const node = view.state.doc.nodeAt(fromPos);
    if (!node) return false;

    const blockDef = blockRegistry.get(node.type.name);
    if (blockDef && blockDef.capabilities.canDrag === false) return false;

    let tr = view.state.tr;
    const content = node.copy(node.content);
    tr = tr.delete(fromPos, fromPos + node.nodeSize);

    const adjustedTo = toPos > fromPos ? toPos - node.nodeSize : toPos;
    tr = tr.insert(adjustedTo, content);
    view.dispatch(tr);
    view.focus();
    return true;
  },

  // ── 类型转换 ──

  turnInto(view: EditorView, pos: number, targetType: string, attrs?: Record<string, unknown>): boolean {
    const node = view.state.doc.nodeAt(pos);
    if (!node) return false;

    const blockDef = blockRegistry.get(node.type.name);
    if (!blockDef?.capabilities.turnInto?.includes(targetType)) return false;

    const targetNodeType = view.state.schema.nodes[targetType];
    if (!targetNodeType) return false;

    const tr = view.state.tr.setNodeMarkup(pos, targetNodeType, { ...attrs });
    view.dispatch(tr);
    view.focus();
    return true;
  },

  // ── 缩进 ──

  indent(view: EditorView, pos: number): boolean {
    const node = view.state.doc.nodeAt(pos);
    if (!node) return false;

    const blockDef = blockRegistry.get(node.type.name);
    if (!blockDef?.capabilities.canIndent) return false;

    // TODO: 通用缩进（indent attr）+ 列表缩进（sinkListItem）
    return false;
  },

  // ── 减少缩进 ──

  outdent(view: EditorView, pos: number): boolean {
    const node = view.state.doc.nodeAt(pos);
    if (!node) return false;

    const blockDef = blockRegistry.get(node.type.name);
    if (!blockDef?.capabilities.canIndent) return false;

    // TODO: 通用减少缩进 + 列表提升（liftListItem）
    return false;
  },

  // ── 选中 ──

  select(view: EditorView, pos: number): void {
    const tr = view.state.tr.setMeta(blockSelectionKey, {
      action: 'select',
      positions: [pos],
    });
    view.dispatch(tr);
  },

  selectMulti(view: EditorView, positions: number[]): void {
    const tr = view.state.tr.setMeta(blockSelectionKey, {
      action: 'select',
      positions,
    });
    view.dispatch(tr);
  },

  clearSelection(view: EditorView): void {
    const tr = view.state.tr.setMeta(blockSelectionKey, { clear: true });
    view.dispatch(tr);
  },
};
