/**
 * Inline 转换工具函数
 *
 * ProseMirror inline content ↔ Atom InlineElement[] 的双向转换。
 * 被所有包含文本内容的 Converter 共用。
 */

import type { Node as PMNode, Fragment } from 'prosemirror-model';
import type {
  InlineElement,
  TextNode,
  Mark,
  MathInline,
  CodeInline,
  LinkNode,
  NoteLinkNode,
} from '../../../shared/types/atom-types';
import type { PMNodeJSON } from './converter-types';

// ═══════════════════════════════════════════════════════
// ProseMirror → Atom InlineElement[]
// ═══════════════════════════════════════════════════════

/**
 * 将 ProseMirror Node 的 inline content 转换为 InlineElement[]
 */
export function pmInlinesToAtom(node: PMNode): InlineElement[] {
  const result: InlineElement[] = [];

  node.content.forEach((child) => {
    const element = pmInlineNodeToElement(child);
    if (element) result.push(element);
  });

  return result;
}

function pmInlineNodeToElement(node: PMNode): InlineElement | null {
  // mathInline
  if (node.type.name === 'mathInline') {
    return { type: 'math-inline', latex: node.attrs.latex || '' } as MathInline;
  }

  // noteLink
  if (node.type.name === 'noteLink') {
    return {
      type: 'note-link',
      noteId: node.attrs.noteId || '',
      title: node.attrs.title || '',
    } as NoteLinkNode;
  }

  // text node (with marks)
  if (node.isText && node.text) {
    // 检查是否有 link mark（link 在 Atom 中是 InlineElement，不是 Mark）
    const linkMark = node.marks.find(m => m.type.name === 'link');
    if (linkMark) {
      return {
        type: 'link',
        href: linkMark.attrs.href || '',
        title: linkMark.attrs.title || undefined,
        children: [{
          type: 'text',
          text: node.text,
          marks: pmMarksToAtom(node.marks.filter(m => m.type.name !== 'link')),
        }],
      } as LinkNode;
    }

    const marks = pmMarksToAtom(node.marks);
    return {
      type: 'text',
      text: node.text,
      marks: marks.length > 0 ? marks : undefined,
    } as TextNode;
  }

  // hardBreak → 换行符
  if (node.type.name === 'hardBreak') {
    return { type: 'text', text: '\n' } as TextNode;
  }

  return null;
}

function pmMarksToAtom(marks: readonly import('prosemirror-model').Mark[]): Mark[] {
  const result: Mark[] = [];
  for (const mark of marks) {
    switch (mark.type.name) {
      case 'bold': result.push({ type: 'bold' }); break;
      case 'italic': result.push({ type: 'italic' }); break;
      case 'underline': result.push({ type: 'underline' }); break;
      case 'strike': result.push({ type: 'strike' }); break;
      case 'code': result.push({ type: 'code' }); break;
      case 'highlight': result.push({ type: 'highlight', color: mark.attrs.color }); break;
      case 'textStyle': result.push({ type: 'textStyle', color: mark.attrs.color }); break;
      case 'thought': result.push({ type: 'thought', thoughtId: mark.attrs.thoughtId, thoughtType: mark.attrs.thoughtType }); break;
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════
// Atom InlineElement[] → ProseMirror JSON
// ═══════════════════════════════════════════════════════

/**
 * 将 InlineElement[] 转换为 ProseMirror inline content JSON
 */
export function atomInlinesToPM(elements: InlineElement[]): PMNodeJSON[] {
  const result: PMNodeJSON[] = [];

  for (const el of elements) {
    const nodes = elementToPMNodes(el);
    result.push(...nodes);
  }

  return result;
}

function elementToPMNodes(el: InlineElement): PMNodeJSON[] {
  switch (el.type) {
    case 'text': {
      const node: PMNodeJSON = { type: 'text', text: el.text };
      if (el.marks && el.marks.length > 0) {
        node.marks = el.marks.map(atomMarkToPM);
      }
      return [node];
    }

    case 'math-inline':
      return [{ type: 'mathInline', attrs: { latex: el.latex } }];

    case 'code-inline':
      return [{ type: 'text', text: el.code, marks: [{ type: 'code' }] }];

    case 'link': {
      const linkMark = { type: 'link', attrs: { href: el.href, title: el.title || null } };
      return el.children.map(child => {
        const marks = child.marks ? child.marks.map(atomMarkToPM) : [];
        marks.push(linkMark);
        return { type: 'text', text: child.text, marks };
      });
    }

    case 'note-link':
      return [{ type: 'noteLink', attrs: { noteId: el.noteId, title: el.title } }];

    case 'mention':
      return [{ type: 'text', text: `@${el.label}` }];

    default:
      return [];
  }
}

function atomMarkToPM(mark: Mark): { type: string; attrs?: Record<string, unknown> } {
  switch (mark.type) {
    case 'bold': return { type: 'bold' };
    case 'italic': return { type: 'italic' };
    case 'underline': return { type: 'underline' };
    case 'strike': return { type: 'strike' };
    case 'code': return { type: 'code' };
    case 'highlight': return { type: 'highlight', attrs: { color: mark.color } };
    case 'textStyle': return { type: 'textStyle', attrs: { color: mark.color } };
    case 'thought': return { type: 'thought', attrs: { thoughtId: mark.thoughtId, thoughtType: mark.thoughtType || 'thought' } };
    default: return { type: 'bold' }; // fallback
  }
}
