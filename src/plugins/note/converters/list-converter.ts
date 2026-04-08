/**
 * List Converters
 *
 * bulletList / orderedList / taskList ↔ Atom
 * listItem / taskItem ↔ Atom
 *
 * 容器子节点通过 parentId 关联（扁平存储）。
 * ConverterRegistry 的 nodeToAtoms 负责递归遍历子节点。
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { Atom, ListContent, ListItemContent } from '../../../shared/types/atom-types';
import { createAtom } from '../../../shared/types/atom-types';
import type { AtomConverter, PMNodeJSON } from './converter-types';
import { pmInlinesToAtom, atomInlinesToPM } from './inline-utils';

// ── bulletList ──

export const bulletListConverter: AtomConverter = {
  atomTypes: ['bulletList'],
  pmType: 'bulletList',

  toAtom(_node: PMNode, parentId?: string): Atom {
    return createAtom('bulletList', { listType: 'bullet' } as ListContent, parentId);
  },

  toPM(_atom: Atom, childAtoms?: Atom[]): PMNodeJSON {
    return {
      type: 'bulletList',
      content: childAtoms?.map(child => {
        const c = child.content as ListItemContent;
        return {
          type: 'listItem',
          content: [{ type: 'textBlock', content: atomInlinesToPM(c.children) }],
        };
      }) || [],
    };
  },
};

// ── orderedList ──

export const orderedListConverter: AtomConverter = {
  atomTypes: ['orderedList'],
  pmType: 'orderedList',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('orderedList', {
      listType: 'ordered',
      start: node.attrs.start ?? 1,
    } as ListContent, parentId);
  },

  toPM(atom: Atom, childAtoms?: Atom[]): PMNodeJSON {
    const c = atom.content as ListContent;
    return {
      type: 'orderedList',
      attrs: { start: c.start ?? 1 },
      content: childAtoms?.map(child => {
        const cc = child.content as ListItemContent;
        return {
          type: 'listItem',
          content: [{ type: 'textBlock', content: atomInlinesToPM(cc.children) }],
        };
      }) || [],
    };
  },
};

// ── listItem ──

export const listItemConverter: AtomConverter = {
  atomTypes: ['listItem'],
  pmType: 'listItem',

  toAtom(node: PMNode, parentId?: string): Atom {
    // listItem 的第一个子节点是 textBlock（文本内容）
    const firstChild = node.content.firstChild;
    const children = firstChild ? pmInlinesToAtom(firstChild) : [];
    return createAtom('listItem', { children } as ListItemContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as ListItemContent;
    return {
      type: 'listItem',
      content: [{ type: 'textBlock', content: atomInlinesToPM(c.children) }],
    };
  },
};

// ── taskList ──

export const taskListConverter: AtomConverter = {
  atomTypes: ['taskList'],
  pmType: 'taskList',

  toAtom(_node: PMNode, parentId?: string): Atom {
    return createAtom('taskList', { listType: 'task' } as ListContent, parentId);
  },

  toPM(_atom: Atom, childAtoms?: Atom[]): PMNodeJSON {
    return {
      type: 'taskList',
      content: childAtoms?.map(child => {
        const c = child.content as ListItemContent;
        return {
          type: 'taskItem',
          attrs: { checked: c.checked ?? false },
          content: [{ type: 'textBlock', content: atomInlinesToPM(c.children) }],
        };
      }) || [],
    };
  },
};

// ── taskItem ──

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
      content: [{ type: 'textBlock', content: atomInlinesToPM(c.children) }],
    };
  },
};
