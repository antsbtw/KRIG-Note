import type { BlockDef } from '../types';
import { createRenderBlockView, createPlaceholder, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * audioBlock — 音频（RenderBlock）
 *
 * HTML5 audio 播放器 + 标题 + 下载按钮 + caption
 */

const audioRenderer: RenderBlockRenderer = {
  label(node: PMNode) { return node.attrs.title || 'Audio'; },

  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('audio-block');

    const updateAttrs = (attrs: Record<string, unknown>) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      let tr = view.state.tr;
      for (const [key, value] of Object.entries(attrs)) {
        tr = tr.setNodeAttribute(pos, key, value);
      }
      view.dispatch(tr);
    };

    const playerArea = document.createElement('div');
    playerArea.classList.add('audio-block__player');

    if (node.attrs.src) {
      // ── 播放状态 ──

      // 标题
      const titleEl = document.createElement('div');
      titleEl.classList.add('audio-block__title');
      titleEl.textContent = node.attrs.title || 'Audio';
      playerArea.appendChild(titleEl);

      // 播放器
      const audioEl = document.createElement('audio');
      audioEl.src = node.attrs.src;
      audioEl.controls = true;
      audioEl.preload = 'metadata';
      playerArea.appendChild(audioEl);

      // 下载按钮（仅 https:// URL 显示）
      const src = node.attrs.src as string;
      if (src.startsWith('https://') || src.startsWith('http://')) {
        const downloadBtn = document.createElement('button');
        downloadBtn.classList.add('audio-block__download-btn');
        downloadBtn.textContent = '⬇';
        downloadBtn.title = '下载到本地';
        downloadBtn.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          downloadBtn.textContent = '⏳';
          downloadBtn.disabled = true;
          try {
            const api = (window as any).viewAPI;
            if (api?.downloadMedia) {
              const result = await api.downloadMedia(src, 'audio');
              if (result?.success && result.mediaUrl) {
                updateAttrs({ src: result.mediaUrl });
                downloadBtn.textContent = '✅';
              } else {
                downloadBtn.textContent = '❌';
              }
            }
          } catch {
            downloadBtn.textContent = '❌';
          }
          setTimeout(() => { downloadBtn.textContent = '⬇'; downloadBtn.disabled = false; }, 2000);
        });
        playerArea.appendChild(downloadBtn);
      }

      // 存储 audioEl 引用用于 destroy
      (content as any)._audioEl = audioEl;
    } else {
      // ── Placeholder 状态 ──
      const placeholder = createPlaceholder({
        icon: '🎵',
        uploadLabel: 'Upload',
        uploadAccept: 'audio/*',
        embedLabel: 'Embed link',
        embedPlaceholder: 'Paste audio URL (.mp3, .ogg, .wav)...',
        onUpload: (dataUrl, file) => updateAttrs({
          src: dataUrl,
          title: file.name.replace(/\.[^.]+$/, ''),
          mimeType: file.type || null,
        }),
        onEmbed: (url) => updateAttrs({ src: url }),
      });
      playerArea.appendChild(placeholder);
    }

    // ── Caption ──
    const captionDOM = document.createElement('div');
    captionDOM.classList.add('audio-block__caption');

    content.appendChild(playerArea);
    content.appendChild(captionDOM);
    (content as any)._captionDOM = captionDOM;
    return content;
  },

  update(node: PMNode, contentEl: HTMLElement): boolean {
    // 状态切换（placeholder ↔ 播放器）→ 重建 NodeView
    const hasAudio = contentEl.querySelector('audio') !== null;
    const hasSrc = !!node.attrs.src;
    if (hasAudio !== hasSrc) return false;

    // 更新标题
    const titleEl = contentEl.querySelector('.audio-block__title');
    if (titleEl) titleEl.textContent = node.attrs.title || 'Audio';

    // 更新 audio src
    const audioEl = contentEl.querySelector('audio');
    if (audioEl && node.attrs.src && audioEl.src !== node.attrs.src) {
      audioEl.src = node.attrs.src;
    }
    return true;
  },

  getContentDOM(contentEl: HTMLElement) {
    return (contentEl as any)._captionDOM as HTMLElement;
  },

  destroy(contentEl: HTMLElement) {
    const audioEl = (contentEl as any)._audioEl as HTMLAudioElement | undefined;
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
    }
  },
};

export const audioBlockBlock: BlockDef = {
  name: 'audioBlock',
  group: 'block',
  nodeSpec: {
    content: 'textBlock',
    group: 'block',
    draggable: true,
    selectable: true,
    attrs: {
      atomId:      { default: null },
      sourcePages: { default: null },
      thoughtId:   { default: null },
      src:         { default: null },
      title:       { default: 'Audio' },
      mimeType:    { default: null },
      duration:    { default: null },
    },
    parseDOM: [{ tag: 'div.audio-block' }],
    toDOM() { return ['div', { class: 'audio-block' }, 0]; },
  },
  nodeView: createRenderBlockView(audioRenderer, 'audioBlock'),
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'Audio', icon: '🎵', group: 'media', keywords: ['audio', 'music', 'sound', 'mp3', 'podcast', '音频'], order: 3 },
};
