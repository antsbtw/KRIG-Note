import type { BlockDef, NodeViewFactory } from '../types';

/**
 * audioBlock — 音频播放器
 *
 * NodeView 渲染 <audio> 播放器 + 元数据。
 * contentDOM 包含 paragraph（caption）。
 * src 为空时显示上传占位符。
 */

const audioBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('audio-block');

  const playerWrapper = document.createElement('div');
  playerWrapper.classList.add('audio-block__player');

  const audio = document.createElement('audio');
  audio.classList.add('audio-block__audio');
  audio.controls = true;
  if (node.attrs.src) audio.src = node.attrs.src;
  audio.style.display = node.attrs.src ? 'block' : 'none';

  const meta = document.createElement('div');
  meta.classList.add('audio-block__meta');
  meta.style.display = node.attrs.title ? 'block' : 'none';

  function updateMeta() {
    const parts: string[] = [];
    if (node.attrs.title) parts.push(node.attrs.title);
    if (node.attrs.artist) parts.push(node.attrs.artist);
    meta.textContent = parts.join(' — ');
    meta.style.display = parts.length > 0 ? 'block' : 'none';
  }
  updateMeta();

  const placeholder = document.createElement('div');
  placeholder.classList.add('audio-block__placeholder');
  placeholder.textContent = '🎵 点击添加音频';
  placeholder.style.display = node.attrs.src ? 'none' : 'flex';

  placeholder.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        src: url,
        title: file.name.replace(/\.[^.]+$/, ''),
      });
      view.dispatch(tr);
    };
    input.click();
  });

  playerWrapper.appendChild(meta);
  playerWrapper.appendChild(audio);
  playerWrapper.appendChild(placeholder);

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('audio-block__caption');

  dom.appendChild(playerWrapper);
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'audioBlock') return false;
      if (updatedNode.attrs.src) {
        audio.src = updatedNode.attrs.src;
        audio.style.display = 'block';
        placeholder.style.display = 'none';
      } else {
        audio.style.display = 'none';
        placeholder.style.display = 'flex';
      }
      node = updatedNode;
      updateMeta();
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === playerWrapper || playerWrapper.contains(mutation.target as Node);
    },
  };
};

export const audioBlockBlock: BlockDef = {
  name: 'audioBlock',
  group: 'block',

  nodeSpec: {
    content: 'paragraph',
    group: 'block',
    attrs: {
      src: { default: null },
      title: { default: '' },
      artist: { default: '' },
      duration: { default: 0 },
    },
    parseDOM: [{ tag: 'div.audio-block' }],
    toDOM() { return ['div', { class: 'audio-block' }, 0]; },
  },

  nodeView: audioBlockNodeView,

  capabilities: {
    canDelete: true,
    canDrag: true,
  },

  slashMenu: {
    label: 'Audio',
    icon: '🎵',
    group: 'media',
    keywords: ['audio', 'music', 'sound', 'podcast', '音频'],
    order: 2,
  },
};
