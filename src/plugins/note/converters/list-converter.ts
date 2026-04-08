/**
 * List Converters
 *
 * KRIG-Note 列表结构（和 mirro-desktop 不同）：
 *   bulletList  content: 'block+'  → 直接包含 textBlock，无 listItem 中间层
 *   orderedList content: 'block+'  → 同上
 *   taskList    content: 'taskItem+' → taskItem content: 'block+'
 *
 * 容器子节点由 ConverterRegistry 递归遍历（parentId 关联）。
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { Atom, ListContent, ListItemContent } from '../../../shared/types/atom-types';
import { createAtom } from '../../../shared/types/atom-types';
import type { AtomConverter, PMNodeJSON } from './converter-types';
import { pmInlinesToAtom, atomInlinesToPM } from './inline-utils';

// ── bulletList ──
// content: 'block+' → 子节点直接是 textBlock 等，无 listItem

export const bulletListConverter: AtomConverter = {
  atomTypes: ['bulletList'],
  pmType: 'bulletList',

  toAtom(_node: PMNode, parentId?: string): Atom {
    return createAtom('bulletList', { listType: 'bullet' } as ListContent, parentId);
  },

  toPM(_atom: Atom): PMNodeJSON {
    // 子节点由 ConverterRegistry 递归填充
    return { type: 'bulletList' };
  },
};

// ── orderedList ──
// content: 'block+' → 同 bulletList

export const orderedListConverter: AtomConverter = {
  atomTypes: ['orderedList'],
  pmType: 'orderedList',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('orderedList', {
      listType: 'ordered',
      start: node.attrs.start ?? 1,
    } as ListContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as ListContent;
    return {
      type: 'orderedList',
      attrs: { start: c.start ?? 1 },
    };
  },
};

// ── taskList ──
// content: 'taskItem+' → 子节点是 taskItem

export const taskListConverter: AtomConverter = {
  atomTypes: ['taskList'],
  pmType: 'taskList',

  toAtom(_node: PMNode, parentId?: string): Atom {
    return createAtom('taskList', { listType: 'task' } as ListContent, parentId);
  },

  toPM(_atom: Atom): PMNodeJSON {
    return { type: 'taskList' };
  },
};

// ── taskItem ──
// content: 'block+' → 子节点是 textBlock 等

export const taskItemConverter: AtomConverter = {
  atomTypes: ['taskItem'],
  pmType: 'taskItem',

  toAtom(node: PMNode, parentId?: string): Atom {
    const firstChild = node.content.firstChild;
    const children = firstChild ? pmInlinesToAtom(firstChild) : [];
    return createAtom('taskItem', {
      children,
      checked: node.attrs.checked ?? false,
    } as ListItemContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as ListItemContent;
    return {
      type: 'taskItem',
      attrs: { checked: c.checked ?? false },
      content: c.children.length > 0
        ? [{ type: 'textBlock', content: atomInlinesToPM(c.children) }]
        : [{ type: 'textBlock' }],
    };
  },
};
