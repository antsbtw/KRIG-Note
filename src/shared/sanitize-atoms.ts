/**
 * sanitizeAtoms — 清洗后端返回的 Atom 数据
 *
 * 职责：
 * 1. v1 → v2 类型迁移（kebab-case → camelCase，partTitle → noteTitle）
 * 2. 过滤 document root（v2 不需要）
 * 3. 清理顶层 atom 的 parentId（v1 中指向 document root 的引用）
 * 4. v1 meta.sourcePages → from.pdfPage 迁移
 * 5. 过滤空 text nodes（ProseMirror 不允许）
 * 6. 修正 children 中的 Tiptap 格式 inline 节点为 InlineElement 格式
 */

import type { Atom, AtomType } from './types/atom-types';

// v1 kebab-case → v2 camelCase
const TYPE_MIGRATION: Record<string, AtomType> = {
  'math-block': 'mathBlock',
  'code-block': 'codeBlock',
  'column-list': 'columnList',
  'horizontal-rule': 'horizontalRule',
  'partTitle': 'noteTitle',
};

export function sanitizeAtoms(atoms: Atom[]): Atom[] {
  // 收集 document root id（用于清理顶层 parentId）
  const docRootIds = new Set(
    atoms.filter(a => a.type === 'document').map(a => a.id),
  );

  // listItem 展开：KRIG-Note 的 bulletList/orderedList content 是 'block+'，
  // 没有 listItem 中间层。将 listItem 转为 paragraph，parentId 保持指向列表容器。
  const listItemIds = new Set<string>();
  for (const atom of atoms) {
    if (atom.type === 'listItem') listItemIds.add(atom.id);
  }

  return atoms
    // 过滤 document root
    .filter(a => a.type !== 'document')
    .map(atom => {
      // listItem → paragraph（保留 parentId 指向列表容器）
      if (atom.type === 'listItem') {
        atom.type = 'paragraph' as Atom['type'];
      }
      // 类型迁移
      const migrated = TYPE_MIGRATION[atom.type];
      if (migrated) {
        atom.type = migrated;
      }

      // 清理指向 document root 的 parentId
      if (atom.parentId && docRootIds.has(atom.parentId)) {
        delete atom.parentId;
      }

      // v1 meta.sourcePages → from 迁移
      const meta = atom.meta as unknown as Record<string, unknown>;
      const sourcePages = meta?.sourcePages as { startPage?: number; endPage?: number } | undefined;
      if (sourcePages && !atom.from) {
        atom.from = {
          extractionType: 'pdf',
          pdfPage: sourcePages.startPage ?? 1,
          extractedAt: atom.meta?.createdAt ?? Date.now(),
        };
      }
      if (meta) {
        delete meta.sourcePages;
      }

      // 清洗 content.children
      const content = atom.content as Record<string, unknown>;
      if (Array.isArray(content?.children)) {
        content.children = sanitizeChildren(content.children as Record<string, unknown>[]);
        // children 全部被清除 → 补占位空格
        if ((content.children as unknown[]).length === 0) {
          content.children = [{ type: 'text', text: ' ' }];
        }
      }

      // 清洗 tiptapContent
      if (Array.isArray(content?.tiptapContent)) {
        content.tiptapContent = sanitizeTiptapContent(content.tiptapContent as Record<string, unknown>[]);
      }

      return atom;
    });
}

/** 清洗 children 中的 inline 节点 */
function sanitizeChildren(children: Record<string, unknown>[]): Record<string, unknown>[] {
  return children
    .map(child => {
      // Tiptap 格式 mathInline → InlineElement 格式 math-inline
      if (child.type === 'mathInline') {
        const attrs = child.attrs as Record<string, unknown> | undefined;
        const latex = (attrs?.latex as string) ?? (child.latex as string) ?? '';
        return { type: 'math-inline', latex };
      }
      return child;
    })
    .filter(child => {
      // 过滤空 text 节点
      if (child.type === 'text') {
        const text = child.text as string;
        return text != null && text.length > 0;
      }
      return true;
    });
}

/** 递归清洗 tiptapContent 中嵌套的空 text nodes */
function sanitizeTiptapContent(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
  return nodes
    .filter(node => {
      if (node.type === 'text') {
        return node.text != null && (node.text as string).length > 0;
      }
      return true;
    })
    .map(node => {
      if (Array.isArray(node.content)) {
        const cleaned = sanitizeTiptapContent(node.content as Record<string, unknown>[]);
        if (cleaned.length === 0 && (node.type === 'paragraph' || node.type === 'heading')) {
          return { ...node, content: [{ type: 'text', text: ' ' }] };
        }
        return { ...node, content: cleaned };
      }
      return node;
    });
}
