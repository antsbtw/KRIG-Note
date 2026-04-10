import { noteStore } from '../storage/note-store';
import { folderStore } from '../storage/folder-store';
import { createAtom, generateAtomId } from '../../shared/types/atom-types';
import { sanitizeAtoms } from '../../shared/sanitize-atoms';
import type { Atom, NoteTitleContent, ParagraphContent } from '../../shared/types/atom-types';

/**
 * PDF Extraction Import Service
 *
 * 章节导入流程：
 * 1. 查找或创建以 PDF 文件名命名的文件夹
 * 2. 每个章节创建一个独立 Note（noteTitle = 章节名）
 * 3. 按页面插入 pageAnchor 锚点，确保 PDF↔Note 双向定位
 *
 * 数据格式：
 *   { bookName, chapters: [{ title, pageStart, pageEnd, pages: [...] }, ...] }
 */

interface ImportResult {
  noteId: string;
  folderId: string;
  title: string;
  atomCount: number;
}

interface ChapterImportResult {
  folderId: string;
  notes: ImportResult[];
}

export async function importExtractionData(data: any): Promise<ImportResult> {
  const chapters: any[] = data.chapters;
  if (!Array.isArray(chapters) || chapters.length === 0) {
    throw new Error('[Import] data.chapters is required and must be a non-empty array');
  }

  const result = await importChapters(data);

  if (result.notes.length === 0) {
    // 所有章节已存在，返回文件夹信息
    console.log('[Import] All chapters already exist, nothing to import');
    return { noteId: '', folderId: result.folderId, title: '', atomCount: 0 };
  }

  // 返回最后一个 Note 的结果（用于 UI 跳转）
  return result.notes[result.notes.length - 1];
}

/** 逐章节批量导入 */
async function importChapters(data: any): Promise<ChapterImportResult> {
  const pdfFileName = extractPdfFileName(data);

  console.log(`[Import] Batch import: "${pdfFileName}", ${data.chapters.length} chapters`);

  // 1. 创建以 PDF 文件名命名的文件夹
  const folderId = await getOrCreateFolder(pdfFileName);

  // 查询已有笔记列表（用于增选去重）
  const existingNotes = await noteStore.list();
  const existingTitlesInFolder = new Set(
    existingNotes
      .filter((n: any) => n.folder_id === folderId)
      .map((n: any) => n.title),
  );

  // 2. 逐章节创建 Note（跳过同文件夹下已存在的同名笔记）
  const notes: ImportResult[] = [];
  for (const chapter of data.chapters) {
    const chapterTitle = chapter.title || `${pdfFileName} (p${chapter.pageStart}-${chapter.pageEnd})`;

    if (existingTitlesInFolder.has(chapterTitle)) {
      console.log(`[Import] Skipped (already exists): "${chapterTitle}"`);
      continue;
    }

    const pages = chapter.pages || extractPages(chapter);
    const docContent = buildDocContent(chapterTitle, pages);

    const note = await noteStore.create(chapterTitle, folderId);
    await noteStore.save(note.id, docContent, chapterTitle);
    existingTitlesInFolder.add(chapterTitle); // 防止同批次内重复

    console.log(`[Import] Chapter: "${chapterTitle}" (${docContent.length} atoms, pages ${chapter.pageStart}-${chapter.pageEnd})`);

    notes.push({
      noteId: note.id,
      folderId,
      title: chapterTitle,
      atomCount: docContent.length,
    });
  }

  return { folderId, notes };
}

/** 从 data 中提取 PDF 文件名（去掉 .pdf 后缀） */
function extractPdfFileName(data: any): string {
  const raw = data.bookName || data.fileName || 'PDF Extraction';
  return raw.replace(/\.pdf$/i, '');
}

/** 查找或创建以文件名命名的文件夹 */
async function getOrCreateFolder(folderName: string): Promise<string> {
  const folders = await folderStore.list();
  const existing = folders.find((f: any) => f.title === folderName);
  if (existing) {
    return typeof existing.id === 'string'
      ? existing.id.replace(/^folder:⟨?|⟩?$/g, '')
      : String(existing.id);
  }
  const newFolder = await folderStore.create(folderName);
  return typeof newFolder.id === 'string'
    ? newFolder.id.replace(/^folder:⟨?|⟩?$/g, '')
    : String(newFolder.id);
}

/** 将 pages 转换为 KRIG Atom[]（每个 atom 的 from.pdfPage 记录来源页码） */
function buildDocContent(title: string, pages: Array<{ pageNumber: number; atoms: any[] }>): Atom[] {
  const allAtoms: Atom[] = [];

  // noteTitle
  allAtoms.push(createAtom('noteTitle', {
    children: [{ type: 'text', text: title }],
  } as NoteTitleContent));

  console.log(`[Import:buildDocContent] pages count: ${pages.length}`);
  for (const page of pages) {
    for (const atom of page.atoms) {
      const converted = convertAtom(atom, page.pageNumber);
      if (converted) allAtoms.push(converted);
    }
  }

  console.log(`[Import:buildDocContent] before sanitize: ${allAtoms.length} atoms, types:`,
    allAtoms.reduce((acc, a) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {} as Record<string, number>));

  // 确保文档至少有一个空段落
  if (allAtoms.length <= 1) {
    allAtoms.push(createAtom('paragraph', { children: [] } as ParagraphContent));
  }

  // 容错清洗（v1→v2 迁移、空节点过滤、类型修正）
  const result = sanitizeAtoms(allAtoms);

  console.log(`[Import:buildDocContent] after sanitize: ${result.length} atoms, types:`,
    result.reduce((acc, a) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {} as Record<string, number>));

  // 打印前 5 个 atom 的 type 和 content 概要
  for (const a of result.slice(0, 5)) {
    const c = a.content as any;
    const text = c?.children?.[0]?.text?.slice(0, 40) || c?.code?.slice(0, 40) || c?.latex?.slice(0, 40) || '';
    console.log(`[Import:atom] type=${a.type}, pdfPage=${a.from?.pdfPage ?? 'none'}, text="${text}"`);
  }

  return result;
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

  const { parentId, ...rest } = atom;

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
  if (parentId) {
    result.parentId = parentId;
  }

  return result;
}
