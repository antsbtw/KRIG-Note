import type { EditorView } from 'prosemirror-view';
import { Node as PMNode } from 'prosemirror-model';
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

    const schema = view.state.schema;
    const targetNodeType = schema.nodes[targetType];
    if (!targetNodeType) return false;

    const targetDef = blockRegistry.get(targetType);
    let tr = view.state.tr;

    // 列表类型集合
    const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

    // 判断转换方式
    if (LIST_TYPES.has(node.type.name) && LIST_TYPES.has(targetType)) {
      // 列表间互转：保留子项内容，只换外壳类型
      // taskList 的子项是 taskItem，其他是 listItem——需要转换子项类型
      const children: import('prosemirror-model').Node[] = [];
      node.forEach((child) => {
        if (targetType === 'taskList' && child.type.name === 'listItem') {
          // listItem → taskItem
          const taskItemType = schema.nodes.taskItem;
          if (taskItemType) children.push(taskItemType.create({ checked: false }, child.content));
          else children.push(child);
        } else if (targetType !== 'taskList' && child.type.name === 'taskItem') {
          // taskItem → listItem
          const listItemType = schema.nodes.listItem;
          if (listItemType) children.push(listItemType.create(null, child.content));
          else children.push(child);
        } else {
          children.push(child);
        }
      });
      const newList = targetNodeType.create(attrs || null, children);
      tr = tr.replaceWith(pos, pos + node.nodeSize, newList);
    } else if (targetDef?.containerRule !== undefined) {
      // 目标是 Container（如 blockquote）→ 包裹当前 Block
      const wrapper = targetNodeType.create(attrs || null, node);
      tr = tr.replaceWith(pos, pos + node.nodeSize, wrapper);
    } else if (targetType === 'codeBlock') {
      // paragraph → codeBlock：提取纯文本
      const textContent = node.textContent;
      const codeNode = targetNodeType.create(attrs || null, textContent ? [schema.text(textContent)] : []);
      tr = tr.replaceWith(pos, pos + node.nodeSize, codeNode);
    } else {
      // 同 content 类型之间切换（如 paragraph ↔ heading）→ setNodeMarkup
      try {
        // 保留目标类型有的 attrs（如 indent），覆盖传入的 attrs
        const targetDefaults: Record<string, unknown> = {};
        if (targetNodeType.spec.attrs) {
          for (const key of Object.keys(targetNodeType.spec.attrs)) {
            // 继承源节点的同名 attr（如 indent）
            if (key in node.attrs) targetDefaults[key] = node.attrs[key];
          }
        }
        tr = tr.setNodeMarkup(pos, targetNodeType, { ...targetDefaults, ...attrs });
      } catch {
        // content 不兼容时，提取文本重建
        const textContent = node.textContent;
        const newNode = targetNodeType.create(attrs || null, textContent ? [schema.text(textContent)] : []);
        tr = tr.replaceWith(pos, pos + node.nodeSize, newNode);
      }
    }

    view.dispatch(tr);
    view.focus();
    return true;
  },

  // ── 缩进 ──

  indent(view: EditorView, pos: number): boolean {
    const node = view.state.doc.nodeAt(pos);
    if (!node) return false;

    const blockDef = blockRegistry.get(node.type.name);

    // 第一层：Block 有自定义 onIndent？
    if (blockDef?.onIndent) {
      const handled = blockDef.onIndent(view, pos);
      if (handled) return true;
    }

    // 第二层：通用缩进（indent attr +1，最大 8）
    return defaultIndent(view, pos, node);
  },

  // ── 减少缩进 ──

  outdent(view: EditorView, pos: number): boolean {
    const node = view.state.doc.nodeAt(pos);
    if (!node) return false;

    const blockDef = blockRegistry.get(node.type.name);

    // 第一层：Block 有自定义 onOutdent？
    if (blockDef?.onOutdent) {
      const handled = blockDef.onOutdent(view, pos);
      if (handled) return true;
    }

    // 第二层：通用减少缩进（indent attr -1，最小 0）
    return defaultOutdent(view, pos, node);
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

// ── 通用缩进函数（indent attr 方式） ──

const MAX_INDENT = 8;

function defaultIndent(view: EditorView, pos: number, node: import('prosemirror-model').Node): boolean {
  const currentIndent = (node.attrs.indent as number) || 0;
  if (currentIndent >= MAX_INDENT) return false;
  if (node.type.spec.attrs && !('indent' in node.type.spec.attrs)) return false;

  const tr = view.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    indent: currentIndent + 1,
  });
  view.dispatch(tr);
  return true;
}

function defaultOutdent(view: EditorView, pos: number, node: import('prosemirror-model').Node): boolean {
  const currentIndent = (node.attrs.indent as number) || 0;
  if (currentIndent <= 0) return false;
  if (node.type.spec.attrs && !('indent' in node.type.spec.attrs)) return false;

  const tr = view.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    indent: currentIndent - 1,
  });
  view.dispatch(tr);
  return true;
}
