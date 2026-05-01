/**
 * atom-bridge — 画板文字节点的 Atom 形态桥(M2.1)
 *
 * 项目里有两种"Atom"概念,需要明确区分:
 *
 * 1. NoteView 同源 Atom(src/shared/types/atom-types.ts)
 *    - 形态:{ id, type, content, parentId, order, links, from, frame, meta }
 *    - 扁平存储,parentId 关联
 *    - 是真正的语义层 Atom(三层架构 §2.2)
 *    - 画板 Instance.doc 字段就是这个
 *
 * 2. 序列化器 Atom(src/lib/atom-serializers/types.ts)
 *    - 形态:{ type, content?, attrs?, marks?, text? }(嵌套 PM JSON)
 *    - atomsToSvg 消费的是这个
 *
 * 转换路径(spec Canvas-M2.1-TextNode-Spec.md §2.2):
 *   NoteView Atom[]
 *     → converterRegistry.atomsToDoc(atoms)        // 复用 NoteView 转换层
 *     → docJson(PM doc JSON)
 *     → docJson.content                            // 提取 children
 *     → 序列化器 Atom[]                            // 喂给 atomsToSvg
 */

import type { Node as PMNode } from 'prosemirror-model';
import { converterRegistry } from '../../../note/converters/registry';
import { blockRegistry } from '../../../note/registry';
import type { Atom as SerializerAtom } from '../../../../lib/atom-serializers/svg';
import type { Atom as NoteAtom } from '../../../../shared/types/atom-types';

/**
 * Lazy 初始化 converter 注册表.
 *
 * Why:converterRegistry 是模块级单例,但默认空,需要 blockRegistry.initConverters()
 * 注册全部 converter.GraphEditor 创建时会调,但**展示态渲染** TextRenderer 走
 * atomsToDoc 不依赖 GraphEditor — 重启加载画板时,渲染先于编辑器创建,registry
 * 是空的,atomsToDoc 返回空 doc,SVG 出来 0 children,文字看不到.
 *
 * 这里 lazy init:首次桥转换时确保 registry 就绪.initConverters 幂等可重复调.
 */
let convertersInited = false;
function ensureConvertersInited(): void {
  if (convertersInited) return;
  blockRegistry.initConverters();
  convertersInited = true;
}

/**
 * NoteView Atom[](Instance.doc 持久化形态)→ 序列化器形态 PM JSON children
 *
 * 输入空 / undefined 时返回空数组,展示态显示空 mesh.
 */
export function textNodeAtomsToPmJson(atoms: unknown[] | undefined): SerializerAtom[] {
  if (!atoms || atoms.length === 0) return [];
  ensureConvertersInited();
  try {
    const docJson = converterRegistry.atomsToDoc(atoms as NoteAtom[]);
    const stripped = stripNoteTitleFromDocJson(docJson);
    return (stripped?.content ?? []) as SerializerAtom[];
  } catch (e) {
    console.warn('[atom-bridge] atomsToDoc failed, returning empty', e);
    return [];
  }
}

/**
 * NoteView Atom[] → PM doc JSON(用于编辑态 EditorState.create)
 *
 * 与 textNodeAtomsToPmJson 的差别:
 * - 这里返回完整 doc(含 type:'doc'),给 schema.nodeFromJSON
 * - 那里只返回 content children,给序列化器
 */
export function textNodeAtomsToDocJson(atoms: unknown[] | undefined): { type: 'doc'; content: unknown[] } {
  const safeAtoms = (atoms && atoms.length > 0 ? atoms : []) as NoteAtom[];
  ensureConvertersInited();
  try {
    const docJson = converterRegistry.atomsToDoc(safeAtoms);
    const stripped = stripNoteTitleFromDocJson(docJson);
    // 兜底:空 doc 至少含一个空 textBlock,否则 PM 报错(doc 要求 content: 'block+')
    if (!stripped?.content || (stripped.content as unknown[]).length === 0) {
      return { type: 'doc', content: [{ type: 'textBlock', attrs: { isTitle: false }, content: [] }] };
    }
    return stripped as { type: 'doc'; content: unknown[] };
  } catch (e) {
    console.warn('[atom-bridge] atomsToDoc failed in editor path, using empty', e);
    return { type: 'doc', content: [{ type: 'textBlock', attrs: { isTitle: false }, content: [] }] };
  }
}

/** PM doc → NoteView Atom[](commit 时用) */
export function pmDocToNoteAtoms(doc: PMNode): NoteAtom[] {
  ensureConvertersInited();
  try {
    return converterRegistry.docToAtoms(doc);
  } catch (e) {
    console.warn('[atom-bridge] docToAtoms failed, returning empty', e);
    return [];
  }
}

/**
 * 剥掉 atomsToDoc 硬补的 noteTitle 节点(画板节点没有 title 概念)
 * 沿用 NoteEditor.tsx stripNoteTitleFromDocJson 的逻辑
 */
function stripNoteTitleFromDocJson(docJson: { type?: string; content?: unknown[] } | null | undefined):
  { type: 'doc'; content: unknown[] } | null {
  if (!docJson?.content) return null;
  const filtered = (docJson.content as Array<{ type?: string; attrs?: { isTitle?: boolean } }>).filter(
    (n) => !(n.type === 'textBlock' && n.attrs?.isTitle),
  );
  return {
    type: 'doc',
    content: filtered.length > 0
      ? filtered
      : [{ type: 'textBlock', attrs: { isTitle: false }, content: [] }],
  };
}

/** 判断 ref 是否为文字节点 */
export function isTextNodeRef(ref: string | undefined | null): boolean {
  return ref === 'krig.text.label';
}
