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
    // Don't let later-registered converters steal a pmType that's already
    // bound (e.g. a compat atom → PM mapping shouldn't hijack the canonical
    // PM → atom direction owned by an earlier converter).
    if (!this.byPMType.has(converter.pmType)) {
      this.byPMType.set(converter.pmType, converter);
    }
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
    // 预构建 parentId → children 索引（O(N) 代替每次 O(N) 的 filter）
    const childrenIndex = new Map<string | undefined, Atom[]>();
    for (const atom of atoms) {
      const key = atom.parentId ?? undefined;
      let list = childrenIndex.get(key);
      if (!list) { list = []; childrenIndex.set(key, list); }
      list.push(atom);
    }
    // 各组内按 order 排序
    for (const list of childrenIndex.values()) {
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    const topLevel = childrenIndex.get(undefined) ?? [];
    const content: PMNodeJSON[] = [];

    for (const atom of topLevel) {
      const json = this.atomToPMNodeIndexed(atom, childrenIndex);
      if (json) content.push(json);
    }

    // 兜底：确保第一个节点是 noteTitle
    if (
      content.length === 0 ||
      content[0].type !== 'textBlock' ||
      !content[0].attrs?.isTitle
    ) {
      content.unshift({ type: 'textBlock', attrs: { isTitle: true } });
    }

    return { type: 'doc', content };
  }

  /**
   * 分片版 atomsToDoc — 初始只转换前 chunkSize 个顶层 block，
   * 返回 { doc, loadMore } 供增量追加。
   */
  atomsToDocChunked(atoms: Atom[], chunkSize: number): {
    doc: PMNodeJSON;
    /** 是否还有更多未加载的内容 */
    hasMore: boolean;
    /** 加载下一批顶层 block（返回 PM 节点 JSON 数组） */
    loadMore: (count: number) => { nodes: PMNodeJSON[]; hasMore: boolean };
  } {
    // 预构建索引
    const childrenIndex = new Map<string | undefined, Atom[]>();
    for (const atom of atoms) {
      const key = atom.parentId ?? undefined;
      let list = childrenIndex.get(key);
      if (!list) { list = []; childrenIndex.set(key, list); }
      list.push(atom);
    }
    for (const list of childrenIndex.values()) {
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    const topLevel = childrenIndex.get(undefined) ?? [];
    let cursor = 0;

    const convertBatch = (count: number): PMNodeJSON[] => {
      const batch: PMNodeJSON[] = [];
      const end = Math.min(cursor + count, topLevel.length);
      for (let i = cursor; i < end; i++) {
        const json = this.atomToPMNodeIndexed(topLevel[i], childrenIndex);
        if (json) batch.push(json);
      }
      cursor = end;
      return batch;
    };

    const initialContent = convertBatch(chunkSize);

    // 兜底：确保第一个节点是 noteTitle
    if (
      initialContent.length === 0 ||
      initialContent[0].type !== 'textBlock' ||
      !initialContent[0].attrs?.isTitle
    ) {
      initialContent.unshift({ type: 'textBlock', attrs: { isTitle: true } });
    }

    return {
      doc: { type: 'doc', content: initialContent },
      hasMore: cursor < topLevel.length,
      loadMore(count: number) {
        const nodes = convertBatch(count);
        return { nodes, hasMore: cursor < topLevel.length };
      },
    };
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
      // 恢复 fromPage → atom.from.pdfPage（round-trip 保留）
      const fromPage = node.attrs?.fromPage;
      if (fromPage != null) {
        if (!atom.from) {
          atom.from = { extractionType: 'pdf', pdfPage: fromPage, extractedAt: 0 };
        } else {
          atom.from.pdfPage = fromPage;
        }
      }
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

  /** 使用预构建索引的快速版本（atomsToDoc 专用） */
  private atomToPMNodeIndexed(atom: Atom, childrenIndex: Map<string | undefined, Atom[]>): PMNodeJSON | null {
    const converter = this.byAtomType.get(atom.type);
    if (!converter) return null;

    const children = childrenIndex.get(atom.id) ?? [];
    const json = converter.toPM(atom, children);

    // 统一注入 from.pdfPage → attrs.fromPage（用于 eBook↔Note 锚定同步）
    this.injectFromPage(json, atom);

    if (children.length > 0 && !json.content) {
      json.content = [];
      for (const child of children) {
        const childJson = this.atomToPMNodeIndexed(child, childrenIndex);
        if (childJson) json.content.push(childJson);
      }
    }

    return json;
  }

  /** 兼容版本（pmJsonToAtoms 等场景使用） */
  private atomToPMNode(atom: Atom, allAtoms: Atom[]): PMNodeJSON | null {
    const converter = this.byAtomType.get(atom.type);
    if (!converter) return null;

    const children = allAtoms
      .filter(a => a.parentId === atom.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const json = converter.toPM(atom, children);

    this.injectFromPage(json, atom);

    if (children.length > 0 && !json.content) {
      json.content = [];
      for (const child of children) {
        const childJson = this.atomToPMNode(child, allAtoms);
        if (childJson) json.content.push(childJson);
      }
    }

    return json;
  }

  /** 将 atom.from.pdfPage 注入到 PMNodeJSON.attrs.fromPage */
  private injectFromPage(json: PMNodeJSON, atom: Atom): void {
    const pdfPage = atom.from?.pdfPage;
    if (pdfPage != null) {
      if (!json.attrs) json.attrs = {};
      json.attrs.fromPage = pdfPage;
    }
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
