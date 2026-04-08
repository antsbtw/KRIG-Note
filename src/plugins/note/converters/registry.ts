/**
 * ConverterRegistry — Atom ↔ ProseMirror 批量转换
 *
 * 从 BlockRegistry 自动收集所有 Converter，提供：
 * - docToAtoms(): ProseMirror Doc → Atom[]（扁平，parentId 关联）
 * - atomsToDoc(): Atom[] → ProseMirror Doc JSON
 * - pmJsonToAtoms(): 容错模式，用于数据迁移
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';
import type { Atom, AtomType } from '../../../shared/types/atom-types';
import { createAtom } from '../../../shared/types/atom-types';
import type { AtomConverter, PMNodeJSON } from './converter-types';
import type { BlockDef } from '../types';

export class ConverterRegistry {
  private byAtomType = new Map<AtomType, AtomConverter>();
  private byPMType = new Map<string, AtomConverter>();

  /**
   * 从 BlockDef[] 收集所有 converter
   */
  init(blocks: BlockDef[]): void {
    this.byAtomType.clear();
    this.byPMType.clear();

    for (const block of blocks) {
      if (block.converter) {
        this.registerConverter(block.converter);
      }
    }
  }

  /**
   * 直接注册一个 converter（不依赖 BlockDef）
   */
  registerConverter(converter: AtomConverter): void {
    for (const atomType of converter.atomTypes) {
      this.byAtomType.set(atomType, converter);
    }
    this.byPMType.set(converter.pmType, converter);
  }

  /**
   * ProseMirror Doc → Atom[]（扁平数组）
   *
   * 遍历 doc 的顶层子节点，递归转换。
   * 容器的子节点通过 parentId 关联，不嵌套。
   */
  docToAtoms(doc: PMNode): Atom[] {
    const atoms: Atom[] = [];

    doc.content.forEach((node, _offset, index) => {
      this.nodeToAtoms(node, undefined, index, atoms);
    });

    return atoms;
  }

  /**
   * Atom[] → ProseMirror Doc JSON
   *
   * 从扁平 Atom 数组重建嵌套的 PM Doc 结构。
   */
  atomsToDoc(atoms: Atom[]): PMNodeJSON {
    // 找出顶层 Atom（没有 parentId 的）
    const topLevel = atoms
      .filter(a => !a.parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const content: PMNodeJSON[] = [];

    for (const atom of topLevel) {
      const json = this.atomToPMNode(atom, atoms);
      if (json) content.push(json);
    }

    return { type: 'doc', content };
  }

  /**
   * 容错模式：旧格式 PM JSON → Atom[]
   * 用于数据迁移，遇到无法识别的节点降级为 paragraph
   */
  pmJsonToAtoms(json: unknown[], schema: Schema): Atom[] {
    try {
      const doc = schema.nodeFromJSON({ type: 'doc', content: json });
      return this.docToAtoms(doc);
    } catch {
      // 降级：每个顶层 JSON 对象尝试单独转换
      const atoms: Atom[] = [];
      for (let i = 0; i < json.length; i++) {
        const item = json[i] as Record<string, unknown>;
        try {
          const node = schema.nodeFromJSON(item);
          this.nodeToAtoms(node, undefined, i, atoms);
        } catch {
          // 完全无法解析，降级为 paragraph
          atoms.push(createAtom('paragraph', {
            children: [{ type: 'text', text: String(item) }],
          }));
        }
      }
      return atoms;
    }
  }

  // ── 内部方法 ──

  private nodeToAtoms(
    node: PMNode,
    parentId: string | undefined,
    order: number,
    result: Atom[],
  ): void {
    const converter = this.byPMType.get(node.type.name);

    if (!converter) {
      // 未知节点，跳过（如 doc 根节点本身不转换，但其子节点会被遍历）
      // 递归子节点
      node.content.forEach((child, _offset, index) => {
        this.nodeToAtoms(child, parentId, index, result);
      });
      return;
    }

    const atomOrAtoms = converter.toAtom(node, parentId);
    const atoms = Array.isArray(atomOrAtoms) ? atomOrAtoms : [atomOrAtoms];

    for (const atom of atoms) {
      atom.order = order;
      result.push(atom);
    }

    // 对于容器节点，递归转换子节点（parentId 指向容器 Atom）
    if (atoms.length > 0 && node.content.size > 0 && this.isContainer(node)) {
      const containerAtom = atoms[0]; // 容器本身是第一个 Atom
      node.content.forEach((child, _offset, index) => {
        this.nodeToAtoms(child, containerAtom.id, index, result);
      });
    }
  }

  private atomToPMNode(atom: Atom, allAtoms: Atom[]): PMNodeJSON | null {
    const converter = this.byAtomType.get(atom.type);
    if (!converter) return null;

    // 找出此 Atom 的子 Atom
    const children = allAtoms
      .filter(a => a.parentId === atom.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const json = converter.toPM(atom, children);

    // 如果有子 Atom，递归构建 content
    if (children.length > 0 && !json.content) {
      json.content = [];
      for (const child of children) {
        const childJson = this.atomToPMNode(child, allAtoms);
        if (childJson) json.content.push(childJson);
      }
    }

    return json;
  }

  /**
   * 判断 PM 节点是否是容器（其子节点需要独立转换为 Atom）
   * 非容器节点的 inline content 由 converter 内部处理
   */
  private isContainer(node: PMNode): boolean {
    // 如果节点的内容是 block 类型，它就是容器
    if (node.content.size === 0) return false;
    const firstChild = node.content.firstChild;
    if (!firstChild) return false;
    return firstChild.isBlock;
  }
}

export const converterRegistry = new ConverterRegistry();
