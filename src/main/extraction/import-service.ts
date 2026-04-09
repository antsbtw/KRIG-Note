import { noteStore } from '../storage/note-store';
import { folderStore } from '../storage/folder-store';
import { createAtom, generateAtomId } from '../../shared/types/atom-types';
import { sanitizeAtoms } from '../../shared/sanitize-atoms';
import type { Atom, NoteTitleContent, ParagraphContent } from '../../shared/types/atom-types';

/**
 * PDF Extraction Import Service
 *
 * 将 Platform 返回的 JSON 数据导入为 KRIG Note：
 * 1. 创建以书名命名的文件夹（如不存在）
 * 2. 按章节或页面范围命名 Note
 * 3. sanitizeAtoms() 容错清洗（v1→v2 迁移、空节点过滤）
 * 4. 转换 Platform Atom → KRIG Atom 格式（补 from 来源追溯）
 */

interface ImportResult {
  noteId: string;
  folderId: string;
  title: string;
  atomCount: number;
}

export async function importExtractionData(data: any): Promise<ImportResult> {
  // 1. 解析元数据
  const bookName = data.bookName || data.fileName || 'PDF Extraction';
  const pageRange = data.pageRange || '';
  const chapterTitle = data.chapterTitle || '';

  // 判断是章节还是页面范围
  const noteTitle = chapterTitle
    ? chapterTitle                          // 按章节名命名
    : pageRange
      ? `${bookName} (p${pageRange})`       // 按页面范围命名
      : bookName;                           // fallback 到书名

  console.log(`[Import] Book: "${bookName}", Note: "${noteTitle}"`);

  // 2. 创建或查找书名文件夹
  const folderId = await getOrCreateFolder(bookName);

  // 3. 构建 doc_content (Atom[])
  const docContent = buildDocContent(noteTitle, data);

  // 4. 创建 Note 到文件夹中
  const note = await noteStore.create(noteTitle, folderId);
  await noteStore.save(note.id, docContent, noteTitle);

  console.log(`[Import] Created Note "${noteTitle}" (${docContent.length} atoms) in folder "${bookName}"`);

  return {
    noteId: note.id,
    folderId,
    title: noteTitle,
    atomCount: docContent.length,
  };
}

/** 查找或创建以书名命名的文件夹 */
async function getOrCreateFolder(bookName: string): Promise<string> {
  const folders = await folderStore.list();
  const existing = folders.find((f: any) => f.title === bookName);
  if (existing) {
    return typeof existing.id === 'string'
      ? existing.id.replace(/^folder:⟨?|⟩?$/g, '')
      : String(existing.id);
  }
  const newFolder = await folderStore.create(bookName);
  return typeof newFolder.id === 'string'
    ? newFolder.id.replace(/^folder:⟨?|⟩?$/g, '')
    : String(newFolder.id);
}

/** 将 Platform JSON 转换为 KRIG Atom[] */
function buildDocContent(title: string, data: any): Atom[] {
  const allAtoms: Atom[] = [];

  // noteTitle
  allAtoms.push(createAtom('noteTitle', {
    children: [{ type: 'text', text: title }],
  } as NoteTitleContent));

  // 提取页面 atoms
  const pages = extractPages(data);

  for (const page of pages) {
    for (const atom of page.atoms) {
      const converted = convertAtom(atom, page.pageNumber);
      if (converted) allAtoms.push(converted);
    }
  }

  // 确保文档至少有一个空段落
  if (allAtoms.length <= 1) {
    allAtoms.push(createAtom('paragraph', { children: [] } as ParagraphContent));
  }

  // 容错清洗（v1→v2 迁移、空节点过滤、类型修正）
  return sanitizeAtoms(allAtoms);
}

/** 从多种 JSON 格式中提取 pages 数组 */
function extractPages(data: any): Array<{ pageNumber: number; atoms: any[] }> {
  if (data.pages && Array.isArray(data.pages)) {
    return data.pages;
  }
  if (data.tasks && Array.isArray(data.tasks)) {
    const pages: Array<{ pageNumber: number; atoms: any[] }> = [];
    for (const task of data.tasks) {
      const taskPages = task.result?.pages || task.pages || [];
      pages.push(...taskPages);
    }
    return pages;
  }
  return [];
}

/** 将单个 Platform atom 转换为 KRIG Atom */
function convertAtom(atom: any, pageNumber: number): Atom | null {
  // 跳过 document 根节点（v2 不需要）
  if (atom.type === 'document') return null;

  // 移除指向 document root 的 parentId（保留容器内的 parentId，如 listItem → bulletList）
  const { parentId, ...rest } = atom;
  const isChildOfDocRoot = !rest.parentId || atom.type === 'document';

  const now = Date.now();
  const result: Atom = {
    ...rest,
    id: rest.id || generateAtomId(),
    from: rest.from || {
      extractionType: 'pdf' as const,
      pdfPage: pageNumber,
      extractedAt: now,
    },
    meta: {
      createdAt: now,
      updatedAt: now,
      dirty: true,
      ...rest.meta,
    },
  };

  // 保留容器子节点的 parentId（如 listItem 指向 bulletList）
  // 只移除指向 document root 的 parentId（由 sanitizeAtoms 统一处理）
  if (parentId) {
    result.parentId = parentId;
  }

  return result;
}
