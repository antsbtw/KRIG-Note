import type { BlockDef, NodeViewFactory } from '../types';

/**
 * tweetBlock — 推文/社交媒体嵌入
 *
 * 输入 URL → 渲染嵌入预览。
 * contentDOM 包含 paragraph（caption）。
 */

const tweetBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('tweet-block');

  const embedWrapper = document.createElement('div');
  embedWrapper.classList.add('tweet-block__embed');

  function renderEmbed(url: string | null) {
    embedWrapper.innerHTML = '';

    if (!url) {
      const placeholder = document.createElement('div');
      placeholder.classList.add('tweet-block__placeholder');
      placeholder.textContent = '🐦 点击添加推文 URL';
      placeholder.addEventListener('click', showUrlInput);
      embedWrapper.appendChild(placeholder);
      return;
    }

    // 简化预览：显示 URL + iframe（如果支持）
    const preview = document.createElement('div');
    preview.classList.add('tweet-block__preview');

    const icon = document.createElement('span');
    icon.textContent = '🐦 ';

    const link = document.createElement('a');
    link.href = url;
    link.textContent = url;
    link.target = '_blank';
    link.style.color = '#8ab4f8';
    link.style.wordBreak = 'break-all';

    const meta = document.createElement('div');
    meta.classList.add('tweet-block__meta');
    if (node.attrs.author) meta.textContent = `@${node.attrs.author}`;
    if (node.attrs.text) {
      const textEl = document.createElement('div');
      textEl.classList.add('tweet-block__text');
      textEl.textContent = node.attrs.text;
      preview.appendChild(textEl);
    }

    preview.appendChild(icon);
    preview.appendChild(link);
    if (node.attrs.author) preview.appendChild(meta);

    embedWrapper.appendChild(preview);
  }

  function showUrlInput() {
    embedWrapper.innerHTML = '';
    const inputWrapper = document.createElement('div');
    inputWrapper.classList.add('tweet-block__url-input');

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '输入推文 URL (Twitter/X)...';
    input.classList.add('tweet-block__url-field');

    const btn = document.createElement('button');
    btn.textContent = '确定';
    btn.classList.add('tweet-block__url-btn');

    function commit() {
      const url = input.value.trim();
      if (!url) return;
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, tweetUrl: url });
      view.dispatch(tr);
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); renderEmbed(node.attrs.tweetUrl); }
    });
    btn.addEventListener('click', commit);

    inputWrapper.appendChild(input);
    inputWrapper.appendChild(btn);
    embedWrapper.appendChild(inputWrapper);
    input.focus();
  }

  renderEmbed(node.attrs.tweetUrl);

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('tweet-block__caption');

  dom.appendChild(embedWrapper);
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'tweetBlock') return false;
      if (updatedNode.attrs.tweetUrl !== node.attrs.tweetUrl) {
        node = updatedNode;
        renderEmbed(updatedNode.attrs.tweetUrl);
      }
      node = updatedNode;
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === embedWrapper || embedWrapper.contains(mutation.target as Node);
    },
    stopEvent(event) {
      if (embedWrapper.contains(event.target as Node)) return true;
      return false;
    },
  };
};

export const tweetBlockBlock: BlockDef = {
  name: 'tweetBlock',
  group: 'block',

  nodeSpec: {
    content: 'textBlock',
    group: 'block',
    attrs: {
      tweetUrl: { default: null },
      author: { default: '' },
      text: { default: '' },
    },
    parseDOM: [{ tag: 'div.tweet-block' }],
    toDOM() { return ['div', { class: 'tweet-block' }, 0]; },
  },

  nodeView: tweetBlockNodeView,

  capabilities: {
    canDelete: true,
    canDrag: true,
  },

  slashMenu: {
    label: 'Tweet',
    icon: '🐦',
    group: 'media',
    keywords: ['tweet', 'twitter', 'social', 'embed', 'x', '推文'],
    order: 3,
  },
};
