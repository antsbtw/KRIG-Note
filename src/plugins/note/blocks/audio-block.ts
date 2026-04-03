import type { BlockDef } from '../types';
import { createRenderBlockView, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * audioBlock — 音频播放器（RenderBlock）
 */

const audioRenderer: RenderBlockRenderer = {
  label(node) {
    return node.attrs.title || 'Audio';
  },

  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('audio-block');
    let currentNode = node;

    const audio = document.createElement('audio');
    audio.classList.add('audio-block__audio');
    audio.controls = true;
    if (node.attrs.src) audio.src = node.attrs.src;
    audio.style.display = node.attrs.src ? 'block' : 'none';

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
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
          ...currentNode.attrs,
          src: url,
          title: file.name.replace(/\.[^.]+$/, ''),
        }));
      };
      input.click();
    });

    const captionDOM = document.createElement('div');
    captionDOM.classList.add('audio-block__caption');

    content.appendChild(audio);
    content.appendChild(placeholder);
    content.appendChild(captionDOM);

    (content as any)._refs = { audio, placeholder, setNode: (n: PMNode) => { currentNode = n; } };
    (content as any)._captionDOM = captionDOM;

    return content;
  },

  update(node: PMNode, contentEl: HTMLElement): boolean {
    const refs = (contentEl as any)._refs;
    if (!refs) return true;
    refs.setNode(node);
    if (node.attrs.src) {
      refs.audio.src = node.attrs.src;
      refs.audio.style.display = 'block';
      refs.placeholder.style.display = 'none';
    } else {
      refs.audio.style.display = 'none';
      refs.placeholder.style.display = 'flex';
    }
    return true;
  },

  getContentDOM(contentEl: HTMLElement) {
    return (contentEl as any)._captionDOM as HTMLElement;
  },
};

export const audioBlockBlock: BlockDef = {
  name: 'audioBlock',
  group: 'block',

  nodeSpec: {
    content: 'textBlock',
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

  nodeView: createRenderBlockView(audioRenderer, 'audio'),

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
