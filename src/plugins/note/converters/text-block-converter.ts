/**
 * textBlock Converter
 *
 * ProseMirror textBlock ↔ Atom paragraph / heading / noteTitle
 *
 * 映射规则（Atom 设计文档 §3.3）：
 *   textBlock { level: null }    → paragraph
 *   textBlock { level: 1/2/3 }  → heading
 *   textBlock { isTitle: true }  → noteTitle
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { Atom, ParagraphContent, HeadingContent, NoteTitleContent } from '../../../shared/types/atom-types';
import { createAtom } from '../../../shared/types/atom-types';
import type { AtomConverter, PMNodeJSON } from './converter-types';
import { pmInlinesToAtom, atomInlinesToPM } from './inline-utils';

export const textBlockConverter: AtomConverter = {
  atomTypes: ['paragraph', 'heading', 'noteTitle'],
  pmType: 'textBlock',

  toAtom(node: PMNode, parentId?: string): Atom {
    const { level, isTitle, textIndent, indent, align } = node.attrs;
    const children = pmInlinesToAtom(node);
    // Only persist non-default formatting attrs
    const fmt: Record<string, unknown> = {};
    if (textIndent) fmt.textIndent = true;
    if (indent) fmt.indent = indent;
    if (align && align !== 'left') fmt.align = align;

    if (isTitle) {
      return createAtom('noteTitle', { children } as NoteTitleContent, parentId);
    }
    if (level) {
      return createAtom('heading', { level, children, ...fmt } as HeadingContent, parentId);
    }
    return createAtom('paragraph', { children, ...fmt } as ParagraphContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    if (atom.type === 'noteTitle') {
      const c = atom.content as NoteTitleContent;
      return {
        type: 'textBlock',
        attrs: { isTitle: true },
        content: atomInlinesToPM(c.children),
      };
    }
    if (atom.type === 'heading') {
      const c = atom.content as HeadingContent;
      return {
        type: 'textBlock',
        attrs: {
          level: c.level,
          textIndent: c.textIndent ?? false,
          indent: c.indent ?? 0,
          align: c.align ?? 'left',
        },
        content: atomInlinesToPM(c.children),
      };
    }
    const c = atom.content as ParagraphContent;
    return {
      type: 'textBlock',
      attrs: {
        textIndent: c.textIndent ?? false,
        indent: c.indent ?? 0,
        align: c.align ?? 'left',
      },
      content: atomInlinesToPM(c.children),
    };
  },
};
