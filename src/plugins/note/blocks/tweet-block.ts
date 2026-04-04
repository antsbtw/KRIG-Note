import type { BlockDef } from '../types';
import { createRenderBlockView, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

const tweetRenderer: RenderBlockRenderer = {
  label() { return 'Tweet'; },
  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('tweet-block');
    if (node.attrs.tweetUrl) {
      content.innerHTML = `<a href="${node.attrs.tweetUrl}" target="_blank" style="color:#8ab4f8">${node.attrs.tweetUrl}</a>`;
    } else {
      content.innerHTML = '<div class="render-block__placeholder">🐦 输入推文 URL<br><input placeholder="https://twitter.com/..." /></div>';
      setTimeout(() => {
        const input = content.querySelector('input');
        input?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const url = (e.target as HTMLInputElement).value.trim();
            if (!url) return;
            const pos = typeof getPos === 'function' ? getPos() : undefined;
            if (pos != null) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, tweetUrl: url }));
          }
        });
      }, 0);
    }
    const captionDOM = document.createElement('div');
    captionDOM.classList.add('render-block__caption');
    content.appendChild(captionDOM);
    (content as any)._captionDOM = captionDOM;
    return content;
  },
  getContentDOM(contentEl: HTMLElement) { return (contentEl as any)._captionDOM; },
};

export const tweetBlockBlock: BlockDef = {
  name: 'tweetBlock',
  group: 'block',
  nodeSpec: {
    content: 'textBlock',
    group: 'block',
    attrs: { tweetUrl: { default: null } },
    parseDOM: [{ tag: 'div.tweet-block' }],
    toDOM() { return ['div', { class: 'tweet-block' }, 0]; },
  },
  nodeView: createRenderBlockView(tweetRenderer, 'tweet'),
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'Tweet', icon: '🐦', group: 'media', keywords: ['tweet', 'twitter', '推文'], order: 4 },
};
