import type { BlockDef } from '../types';
import { createRenderBlockView, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * videoBlock — 视频播放器（RenderBlock）
 */

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/i.test(url);
}

function getYouTubeEmbedUrl(url: string): string {
  const match = url.match(/(?:v=|youtu\.be\/)([^&?]+)/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : url;
}

const videoRenderer: RenderBlockRenderer = {
  label(node) { return node.attrs.title || 'Video'; },

  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('video-block');
    let currentNode = node;

    const playerWrapper = document.createElement('div');
    playerWrapper.classList.add('video-block__player');

    function buildPlayer() {
      playerWrapper.innerHTML = '';
      if (!currentNode.attrs.src) {
        const placeholder = document.createElement('div');
        placeholder.classList.add('video-block__placeholder');
        placeholder.innerHTML = '🎬 输入视频 URL<br><input class="video-block__url-input" placeholder="https://youtube.com/..." />';
        playerWrapper.appendChild(placeholder);
        setTimeout(() => {
          const input = placeholder.querySelector('input');
          input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              const url = (e.target as HTMLInputElement).value.trim();
              if (!url) return;
              const pos = typeof getPos === 'function' ? getPos() : undefined;
              if (pos == null) return;
              view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, src: url }));
            }
          });
        }, 0);
        return;
      }
      const src = currentNode.attrs.src;
      if (isYouTubeUrl(src)) {
        const iframe = document.createElement('iframe');
        iframe.src = getYouTubeEmbedUrl(src);
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.classList.add('video-block__iframe');
        playerWrapper.appendChild(iframe);
      } else {
        const video = document.createElement('video');
        video.src = src;
        video.controls = true;
        video.classList.add('video-block__video');
        if (currentNode.attrs.poster) video.poster = currentNode.attrs.poster;
        playerWrapper.appendChild(video);
      }
    }
    buildPlayer();

    const captionDOM = document.createElement('div');
    captionDOM.classList.add('video-block__caption');
    content.appendChild(playerWrapper);
    content.appendChild(captionDOM);

    (content as any)._refs = { playerWrapper, buildPlayer, setNode: (n: PMNode) => { currentNode = n; } };
    (content as any)._captionDOM = captionDOM;
    return content;
  },

  update(node: PMNode, contentEl: HTMLElement): boolean {
    const refs = (contentEl as any)._refs;
    if (!refs) return true;
    refs.setNode(node);
    refs.buildPlayer();
    return true;
  },

  getContentDOM(contentEl: HTMLElement) {
    return (contentEl as any)._captionDOM as HTMLElement;
  },
};

export const videoBlockBlock: BlockDef = {
  name: 'videoBlock',
  group: 'block',
  nodeSpec: {
    content: 'textBlock',
    group: 'block',
    attrs: { src: { default: null }, title: { default: '' }, poster: { default: null } },
    parseDOM: [{ tag: 'div.video-block' }],
    toDOM() { return ['div', { class: 'video-block' }, 0]; },
  },
  nodeView: createRenderBlockView(videoRenderer, 'video'),
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: {
    label: 'Video',
    icon: '🎬',
    group: 'media',
    keywords: ['video', 'youtube', 'movie', '视频'],
    order: 1,
  },
};
