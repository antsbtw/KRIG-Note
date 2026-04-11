/**
 * MathVisual NodeView — ProseMirror ↔ React 桥接
 *
 * atom 节点，无 contentDOM。所有交互由 React 组件处理。
 * 使用 React 18+ createRoot API。
 */

import { Node as PMNode } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';
import { createRoot, Root } from 'react-dom/client';
import React from 'react';
import { MathVisualComponent } from './MathVisualComponent';
import type { MathVisualData } from './types';
import { DEFAULT_CANVAS_CONFIG } from './types';
import type { NodeViewFactory } from '../../types';

export const mathVisualNodeView: NodeViewFactory = (
  node: PMNode,
  view: EditorView,
  getPos: () => number | undefined,
) => {
  let currentNode = node;

  const dom = document.createElement('div');
  dom.classList.add('math-visual-block');
  dom.setAttribute('data-math-visual', '');
  dom.setAttribute('draggable', 'false');

  let root: Root | null = null;

  function getDataFromNode(n: PMNode): MathVisualData {
    return {
      title: n.attrs.title || undefined,
      functions: n.attrs.functions || [],
      domain: n.attrs.domain || [-5, 5],
      range: n.attrs.range || [-5, 5],
      parameters: n.attrs.parameters || [],
      annotations: n.attrs.annotations || [],
      canvas: { ...DEFAULT_CANVAS_CONFIG, ...(n.attrs.canvas || {}) },
      tangentLines: n.attrs.tangentLines || undefined,
      normalLines: n.attrs.normalLines || undefined,
      integralRegions: n.attrs.integralRegions || undefined,
      featurePoints: n.attrs.featurePoints || undefined,
    };
  }

  function updateAttrs(newData: MathVisualData) {
    const pos = getPos();
    if (pos == null) return;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
      ...currentNode.attrs,
      title: newData.title,
      functions: newData.functions,
      domain: newData.domain,
      range: newData.range,
      parameters: newData.parameters,
      annotations: newData.annotations,
      canvas: newData.canvas,
      tangentLines: newData.tangentLines,
      normalLines: newData.normalLines,
      integralRegions: newData.integralRegions,
      featurePoints: newData.featurePoints,
    });
    view.dispatch(tr);
  }

  function render() {
    const data = getDataFromNode(currentNode);
    const element = React.createElement(MathVisualComponent, {
      data,
      onChange: updateAttrs,
    });
    if (!root) {
      root = createRoot(dom);
    }
    root.render(element);
  }

  render();

  // 阻止画布的原生 dragstart（Mafs pan 需要 pointer events）
  dom.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, true);

  return {
    dom,

    update(updatedNode: PMNode): boolean {
      if (updatedNode.type.name !== 'mathVisual') return false;
      currentNode = updatedNode;
      render();
      return true;
    },

    destroy() {
      if (root) {
        root.unmount();
        root = null;
      }
    },

    stopEvent(event: Event): boolean {
      if (event.type === 'keydown') {
        const key = (event as KeyboardEvent).key;
        // 只放行上下箭头（跳出 block）
        // Backspace/Delete 不传给 PM — atom block 防止误删
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          return false;
        }
      }
      return true;
    },

    selectNode() {
      dom.classList.add('ProseMirror-selectednode');
    },
    deselectNode() {
      dom.classList.remove('ProseMirror-selectednode');
    },

    ignoreMutation(): boolean {
      return true;
    },
  };
}
