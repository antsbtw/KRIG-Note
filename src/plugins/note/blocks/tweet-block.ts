import type { BlockDef } from '../types';
import { createRenderBlockView, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * tweetBlock — 推文/社交媒体嵌入（RenderBlock）
 */

const tweetRenderer: RenderBlockRenderer = {
  label() { return 'Tweet'; },

  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('tweet-block');
    let currentNode = node;

    const previewWrapper = document.createElement('div');
    previewWrapper.classList.add('tweet-block__preview');

    function buildPreview() {
      previewWrapper.innerHTML = '';
      if (!currentNode.attrs.tweetUrl) {
        const placeholder = document.createElement('div');
        placeholder.classList.add('tweet-block__placeholder');
        placeholder.innerHTML = '🐦 输入推文 URL<br><input class="tweet-block__url-input" placeholder="https://twitter.com/..." />';
        previewWrapper.appendChild(placeholder);
        setTimeout(() => {
          const input = placeholder.querySelector('input');
          input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              const url = (e.target as HTMLInputElement).value.trim();
              if (!url) return;
              const pos = typeof getPos === 'function' ? getPos() : undefined;
              if (pos == null) return;
              view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, tweetUrl: url }));
            }
          });
        }, 0);
        return;
      }

      // 简单预览
      const info = document.createElement('div');
      info.classList.add('tweet-block__info');
      if (currentNode.attrs.author) {
        const author = document.createElement('div');
        author.classList.add('tweet-block__author');
        author.textContent = `@${currentNode.attrs.author}`;
        info.appendChild(author);
      }
      if (currentNode.attrs.text) {
        const text = document.createElement('div');
        text.classList.add('tweet-block__text');
        text.textContent = currentNode.attrs.text;
        info.appendChild(text);
      }
      const link = document.createElement('a');
      link.href = currentNode.attrs.tweetUrl;
      link.textContent = currentNode.attrs.tweetUrl;
      link.classList.add('tweet-block__link');
      link.addEventListener('click', (e) => { e.preventDefault(); window.open(currentNode.attrs.tweetUrl, '_blank'); });
      info.appendChild(link);
      previewWrapper.appendChild(info);
    }
    buildPreview();

    const captionDOM = document.createElement('div');
    captionDOM.classList.add('tweet-block__caption');
    content.appendChild(previewWrapper);
    content.appendChild(captionDOM);

    (content as any)._refs = { buildPreview, setNode: (n: PMNode) => { currentNode = n; } };
    (content as any)._captionDOM = captionDOM;
    return content;
  },

  update(node: PMNode, contentEl: HTMLElement): boolean {
    const refs = (contentEl as any)._refs;
    if (!refs) return true;
    refs.setNode(node);
    refs.buildPreview();
    return true;
  },

  getContentDOM(contentEl: HTMLElement) {
    return (contentEl as any)._captionDOM as HTMLElement;
  },
};

export const tweetBlockBlock: BlockDef = {
  name: 'tweetBlock',
  group: 'block',
  nodeSpec: {
    content: 'textBlock',
    group: 'block',
    attrs: { tweetUrl: { default: null }, author: { default: '' }, text: { default: '' } },
    parseDOM: [{ tag: 'div.tweet-block' }],
    toDOM() { return ['div', { class: 'tweet-block' }, 0]; },
  },
  nodeView: createRenderBlockView(tweetRenderer, 'tweet'),
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: {
    label: 'Tweet',
    icon: '🐦',
    group: 'media',
    keywords: ['tweet', 'twitter', 'social', 'embed'],
    order: 3,
  },
};
