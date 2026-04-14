/**
 * mathVisual ↔ Atom Converter
 *
 * atom 节点，所有数据存储在 node.attrs 中（无 text content）。
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { Atom, MathVisualContent } from '../../../shared/types/atom-types';
import { createAtom } from '../../../shared/types/atom-types';
import type { AtomConverter, PMNodeJSON } from './converter-types';

export const mathVisualConverter: AtomConverter = {
  atomTypes: ['mathVisual'],
  pmType: 'mathVisual',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('mathVisual', {
      title: node.attrs.title || undefined,
      functions: node.attrs.functions || [],
      domain: node.attrs.domain || [-5, 5],
      range: node.attrs.range || [-5, 5],
      parameters: node.attrs.parameters || [],
      annotations: node.attrs.annotations || [],
      canvas: node.attrs.canvas || undefined,
      tangentLines: node.attrs.tangentLines || undefined,
      normalLines: node.attrs.normalLines || undefined,
      integralRegions: node.attrs.integralRegions || undefined,
      featurePoints: node.attrs.featurePoints || undefined,
    } as MathVisualContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as MathVisualContent;
    return {
      type: 'mathVisual',
      attrs: {
        title: c.title || null,
        functions: c.functions || [],
        domain: c.domain || [-5, 5],
        range: c.range || [-5, 5],
        parameters: c.parameters || [],
        annotations: c.annotations || [],
        canvas: c.canvas || {},
        tangentLines: c.tangentLines || [],
        normalLines: c.normalLines || [],
        integralRegions: c.integralRegions || [],
        featurePoints: c.featurePoints || [],
      },
    };
  },
};
