/**
 * RenderBlock Converters
 *
 * codeBlock / mathBlock / image / video / audio / tweet ↔ Atom
 * horizontalRule / hardBreak ↔ Atom
 *
 * 渲染块没有 inline children，转换逻辑简单——直接映射 attrs ↔ content。
 */

import type { Node as PMNode } from 'prosemirror-model';
import type {
  Atom,
  CodeBlockContent,
  MathBlockContent,
  ImageContent,
  VideoContent,
  AudioContent,
  TweetContent,
} from '../../../shared/types/atom-types';
import { createAtom } from '../../../shared/types/atom-types';
import type { AtomConverter, PMNodeJSON } from './converter-types';

// ── codeBlock ──

export const codeBlockConverter: AtomConverter = {
  atomTypes: ['codeBlock'],
  pmType: 'codeBlock',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('codeBlock', {
      code: node.textContent,
      language: node.attrs.language || '',
    } as CodeBlockContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as CodeBlockContent;
    return {
      type: 'codeBlock',
      attrs: { language: c.language },
      content: c.code ? [{ type: 'text', text: c.code }] : [],
    };
  },
};

// ── mathBlock ──

export const mathBlockConverter: AtomConverter = {
  atomTypes: ['mathBlock'],
  pmType: 'mathBlock',

  toAtom(node: PMNode, parentId?: string): Atom {
    // mathBlock content: 'text*' — LaTeX 存在 textContent 中
    return createAtom('mathBlock', {
      latex: node.textContent || '',
    } as MathBlockContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as MathBlockContent;
    return {
      type: 'mathBlock',
      content: c.latex ? [{ type: 'text', text: c.latex }] : [],
    };
  },
};

// ── image ──

export const imageConverter: AtomConverter = {
  atomTypes: ['image'],
  pmType: 'image',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('image', {
      src: node.attrs.src || '',
      alt: node.attrs.alt || undefined,
      width: node.attrs.width || undefined,
      height: node.attrs.height || undefined,
      caption: node.attrs.caption || undefined,
    } as ImageContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as ImageContent;
    // image schema 要求 content: 'textBlock'（caption 子节点）
    const captionContent = c.caption
      ? [{ type: 'text', text: c.caption }]
      : [];
    return {
      type: 'image',
      attrs: { src: c.src, alt: c.alt, width: c.width, height: c.height },
      content: [{ type: 'textBlock', content: captionContent }],
    };
  },
};

// ── video ──

export const videoConverter: AtomConverter = {
  atomTypes: ['video'],
  pmType: 'videoBlock',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('video', {
      src: node.attrs.src || '',
      title: node.attrs.title || undefined,
      embedType: node.attrs.embedType || undefined,
      poster: node.attrs.poster || undefined,
    } as VideoContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as VideoContent;
    return {
      type: 'videoBlock',
      attrs: { src: c.src, title: c.title, embedType: c.embedType, poster: c.poster },
    };
  },
};

// ── audio ──

export const audioConverter: AtomConverter = {
  atomTypes: ['audio'],
  pmType: 'audioBlock',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('audio', {
      src: node.attrs.src || '',
      title: node.attrs.title || undefined,
      mimeType: node.attrs.mimeType || undefined,
      duration: node.attrs.duration || undefined,
    } as AudioContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as AudioContent;
    return {
      type: 'audioBlock',
      attrs: { src: c.src, title: c.title, mimeType: c.mimeType, duration: c.duration },
    };
  },
};

// ── tweet ──

export const tweetConverter: AtomConverter = {
  atomTypes: ['tweet'],
  pmType: 'tweetBlock',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('tweet', {
      tweetUrl: node.attrs.tweetUrl || '',
      tweetId: node.attrs.tweetId || undefined,
      text: node.attrs.text || undefined,
    } as TweetContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as TweetContent;
    return {
      type: 'tweetBlock',
      attrs: { tweetUrl: c.tweetUrl, tweetId: c.tweetId, text: c.text },
    };
  },
};

// ── horizontalRule ──

export const horizontalRuleConverter: AtomConverter = {
  atomTypes: ['horizontalRule'],
  pmType: 'horizontalRule',

  toAtom(_node: PMNode, parentId?: string): Atom {
    return createAtom('horizontalRule', {} as any, parentId);
  },

  toPM(): PMNodeJSON {
    return { type: 'horizontalRule' };
  },
};
