/**
 * mathVisual — 交互式函数图形 Block
 *
 * atom 节点，所有数据存储在 attrs 中。
 * 支持多函数绘图、参数动画、切线/法线/积分/特征点等数学工具。
 */

import type { BlockDef } from '../../types';
import { mathVisualNodeView } from './view';

export const mathVisualBlock: BlockDef = {
  name: 'mathVisual',
  group: 'block',

  nodeSpec: {
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false, // Mafs pan 需要 pointer events，拖拽由 handle menu 控制
    attrs: {
      title: { default: null },
      functions: {
        default: [{
          id: '1', expression: 'x^2', label: 'f(x)',
          color: '#2D7FF9', style: 'solid', visible: true, showDerivative: false,
        }],
      },
      domain: { default: [-5, 5] },
      range: { default: [-5, 5] },
      parameters: { default: [] },
      annotations: { default: [] },
      canvas: { default: { height: 350, scaleMode: 'fit', showGrid: true, showAxisLabels: true } },
      tangentLines: { default: [] },
      normalLines: { default: [] },
      integralRegions: { default: [] },
      featurePoints: { default: [] },
    },
    parseDOM: [{
      tag: 'div[data-math-visual]',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        try {
          return {
            functions: JSON.parse(el.getAttribute('data-functions') || '[]'),
            domain: JSON.parse(el.getAttribute('data-domain') || '[-5,5]'),
            range: JSON.parse(el.getAttribute('data-range') || '[-5,5]'),
            parameters: JSON.parse(el.getAttribute('data-parameters') || '[]'),
            annotations: JSON.parse(el.getAttribute('data-annotations') || '[]'),
            canvas: JSON.parse(el.getAttribute('data-canvas') || '{}'),
          };
        } catch {
          return {};
        }
      },
    }],
    toDOM(node) {
      return ['div', {
        'data-math-visual': '',
        'data-functions': JSON.stringify(node.attrs.functions),
        'data-domain': JSON.stringify(node.attrs.domain),
        'data-range': JSON.stringify(node.attrs.range),
        'data-parameters': JSON.stringify(node.attrs.parameters),
        'data-annotations': JSON.stringify(node.attrs.annotations),
        'data-canvas': JSON.stringify(node.attrs.canvas),
        class: 'math-visual-block',
      }];
    },
  },

  nodeView: mathVisualNodeView,
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: {
    label: 'Function Graph',
    icon: '📈',
    group: 'basic',
    keywords: ['graph', 'plot', 'function', 'math', 'visual', '函数图', '绘图'],
    order: 11,
  },
};
