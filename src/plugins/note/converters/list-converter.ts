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

// ── listItem (compat) ──
// KRIG bulletList/orderedList schema 是 content: 'block+'，没有 listItem 中间层。
// 但外部 markdown parser（web-bridge/pipeline/content-to-atoms）产出的是 listItem
// atom。这个 compat converter 把 listItem atom 展平成一个 textBlock 段落，使其
// 能直接放进 bulletList / orderedList 容器里渲染。
export const listItemConverter: AtomConverter = {
  atomTypes: ['listItem'],
  pmType: 'textBlock',

  toAtom(node: PMNode, parentId?: string): Atom {
    const children = pmInlinesToAtom(node);
    return createAtom('listItem', { children } as ListItemContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as ListItemContent;
    return {
      type: 'textBlock',
      content: atomInlinesToPM(c.children ?? []),
    };
  },
};

// ── taskItem ──
// content: 'block+' → 子节点作为独立 Atom 通过 parentId 挂接
// （与 tableCell 同构；早期实现用 children: InlineElement[] 内嵌导致多 block 持久化丢失）

export const taskItemConverter: AtomConverter = {
  atomTypes: ['taskItem'],
  pmType: 'taskItem',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('taskItem', {
      checked: node.attrs.checked ?? false,
      createdAt: node.attrs.createdAt ?? undefined,
      completedAt: node.attrs.completedAt ?? undefined,
      deadline: node.attrs.deadline ?? undefined,
    } as ListItemContent, parentId);
  },

  toPM(atom: Atom, children?: Atom[]): PMNodeJSON {
    const c = atom.content as ListItemContent;
    const attrs = {
      checked: c.checked ?? false,
      createdAt: c.createdAt ?? null,
      completedAt: c.completedAt ?? null,
      deadline: c.deadline ?? null,
    };

    // 新模式：子 Atom 通过 parentId 挂接，由运行器填充 content
    if (children && children.length > 0) {
      return { type: 'taskItem', attrs };
    }

    // 兼容旧数据：content.children（inline 数组）→ 吐出单个 textBlock
    // 再次保存时 toAtom 会按新格式写回，自动升级
    if (Array.isArray(c.children) && c.children.length > 0) {
      return {
        type: 'taskItem',
        attrs,
        content: [{ type: 'textBlock', content: atomInlinesToPM(c.children) }],
      };
    }

    // 空 taskItem：content 是 block+，必须至少一个 block
    return {
      type: 'taskItem',
      attrs,
      content: [{ type: 'textBlock' }],
    };
  },
};
