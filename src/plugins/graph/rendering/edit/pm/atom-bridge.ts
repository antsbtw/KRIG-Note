import type { Node as PMNode } from 'prosemirror-model';
import type { Atom } from '../../../engines/GraphEngine';
import { graphSchema } from './schema';

/**
 * PM Node ↔ Atom[] 双向转换。
 *
 * Atom[] 即 PM doc 的 children，用 toJSON 直接得到（PM 自带的 JSON 序列化）。
 *
 * v1.3 § 4.2：Atom 形态 = ProseMirror node JSON。所以转换是几乎无损的——
 * PM 的 toJSON / Schema.nodeFromJSON 是天然的桥。
 */

/**
 * PM doc → Atom[]
 *
 * 取 doc 的所有 child（block-level），每个 child toJSON 即一个 Atom。
 */
export function pmDocToAtoms(doc: PMNode): Atom[] {
  const atoms: Atom[] = [];
  doc.forEach((child) => {
    atoms.push(child.toJSON() as Atom);
  });
  return atoms;
}

/**
 * Atom[] → PM doc
 *
 * 用 Schema.nodeFromJSON 反序列化每个 atom 为 PMNode，然后用 schema 的 doc
 * 节点把它们包起来。
 *
 * 兼容空 atoms 数组：返回一个空 doc（含一个空 textBlock）。
 */
export function atomsToPmDoc(atoms: Atom[]): PMNode {
  const safeAtoms = atoms && atoms.length > 0
    ? atoms
    : [{ type: 'textBlock', content: [] }];

  const children = safeAtoms.map((atom) => {
    try {
      return graphSchema.nodeFromJSON(atom);
    } catch (e) {
      // schema 不识别的 atom（如 codeBlock 等 P2 类型）→ 回退为含错误提示的 textBlock
      console.warn('[pm/atom-bridge] unknown atom type, falling back', atom, e);
      const text = extractText(atom);
      return graphSchema.nodes.textBlock.create(
        null,
        text ? graphSchema.text(text) : undefined,
      );
    }
  });

  return graphSchema.nodes.doc.create(null, children);
}

function extractText(atom: Atom): string {
  if (!atom || typeof atom !== 'object') return '';
  const a = atom as { text?: string; content?: unknown[] };
  if (typeof a.text === 'string') return a.text;
  if (!Array.isArray(a.content)) return '';
  return a.content.map((c) => extractText(c as Atom)).join('');
}
