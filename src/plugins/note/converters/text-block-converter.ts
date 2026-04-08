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
    const { level, isTitle } = node.attrs;
    const children = pmInlinesToAtom(node);

    if (isTitle) {
      return createAtom('noteTitle', { children } as NoteTitleContent, parentId);
    }
    if (level) {
      return createAtom('heading', { level, children } as HeadingContent, parentId);
    }
    return createAtom('paragraph', { children } as ParagraphContent, parentId);
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
        attrs: { level: c.level },
        content: atomInlinesToPM(c.children),
      };
    }
    const c = atom.content as ParagraphContent;
    return {
      type: 'textBlock',
      content: atomInlinesToPM(c.children),
    };
  },
};
