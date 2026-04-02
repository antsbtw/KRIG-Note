import type { BlockDef, NodeViewFactory } from '../types';

/**
 * videoBlock — 视频播放器（简化版骨架）
 *
 * 支持本地视频文件和 URL（YouTube/Vimeo 等通过 iframe）。
 * contentDOM 包含 paragraph（caption）。
 * 未来升级为 Tab Container（Video / Meta / Subtitle）。
 */

function detectEmbedType(src: string): 'video' | 'iframe' {
  if (/\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(src)) return 'video';
  return 'iframe';
}

function getEmbedUrl(src: string): string {
  // YouTube
  const ytMatch = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  // Vimeo
  const vimeoMatch = src.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  return src;
}

const videoBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('video-block');

  const playerWrapper = document.createElement('div');
  playerWrapper.classList.add('video-block__player');

  function renderPlayer(src: string | null) {
    playerWrapper.innerHTML = '';

    if (!src) {
      const placeholder = document.createElement('div');
      placeholder.classList.add('video-block__placeholder');
      placeholder.textContent = '🎬 点击添加视频';
      placeholder.addEventListener('click', showUrlInput);
      playerWrapper.appendChild(placeholder);
      return;
    }

    const type = detectEmbedType(src);
    if (type === 'video') {
      const video = document.createElement('video');
      video.classList.add('video-block__video');
      video.src = src;
      video.controls = true;
      if (node.attrs.poster) video.poster = node.attrs.poster;
      playerWrapper.appendChild(video);
    } else {
      const iframe = document.createElement('iframe');
      iframe.classList.add('video-block__iframe');
      iframe.src = getEmbedUrl(src);
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      playerWrapper.appendChild(iframe);
    }
  }

  function showUrlInput() {
    playerWrapper.innerHTML = '';
    const inputWrapper = document.createElement('div');
    inputWrapper.classList.add('video-block__url-input');

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '输入视频 URL（YouTube、Vimeo 或直链）...';
    input.classList.add('video-block__url-field');

    const btn = document.createElement('button');
    btn.textContent = '确定';
    btn.classList.add('video-block__url-btn');

    function commit() {
      const url = input.value.trim();
      if (!url) return;
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: url });
      view.dispatch(tr);
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); renderPlayer(node.attrs.src); }
    });
    btn.addEventListener('click', commit);

    inputWrapper.appendChild(input);
    inputWrapper.appendChild(btn);
    playerWrapper.appendChild(inputWrapper);
    input.focus();
  }

  renderPlayer(node.attrs.src);

  const titleBar = document.createElement('div');
  titleBar.classList.add('video-block__title');
  titleBar.textContent = node.attrs.title || '';
  titleBar.style.display = node.attrs.title ? 'block' : 'none';

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('video-block__caption');

  dom.appendChild(playerWrapper);
  dom.appendChild(titleBar);
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'videoBlock') return false;
      if (updatedNode.attrs.src !== node.attrs.src) {
        renderPlayer(updatedNode.attrs.src);
      }
      titleBar.textContent = updatedNode.attrs.title || '';
      titleBar.style.display = updatedNode.attrs.title ? 'block' : 'none';
      node = updatedNode;
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === playerWrapper || playerWrapper.contains(mutation.target as Node)
        || mutation.target === titleBar;
    },
    stopEvent(event) {
      // 让 iframe 和 input 正常接收事件
      if (playerWrapper.contains(event.target as Node)) return true;
      return false;
    },
  };
};

export const videoBlockBlock: BlockDef = {
  name: 'videoBlock',
  group: 'block',

  nodeSpec: {
    content: 'paragraph',
    group: 'block',
    attrs: {
      src: { default: null },
      title: { default: '' },
      poster: { default: null },
      embedType: { default: 'auto' },
    },
    parseDOM: [{ tag: 'div.video-block' }],
    toDOM() { return ['div', { class: 'video-block' }, 0]; },
  },

  nodeView: videoBlockNodeView,

  capabilities: {
    canDelete: true,
    canDrag: true,
  },

  slashMenu: {
    label: 'Video',
    icon: '🎬',
    group: 'media',
    keywords: ['video', 'youtube', 'vimeo', 'movie', '视频'],
    order: 1,
  },
};
