import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { folderStore } from './folder-store';
import { noteStore } from './note-store';
import { isDBReady } from './client';
import { mdToAtoms } from './md-to-atoms';
import { createAtom, type Atom, type NoteTitleContent, type HeadingContent, type ListContent, type ListItemContent, type ParagraphContent } from '../../shared/types/atom-types';

/**
 * 初始化 KRIG-Note 文档库
 *
 * 从项目的 .md 文件批量导入，按目录结构创建 Folder + NoteFile。
 * 只在 "KRIG-Note" 文件夹不存在时执行（避免重复）。
 */

/** 项目根目录（KRIG-Note 仓库） */
const PROJECT_ROOT = path.resolve(process.cwd());

/** 要导入的目录映射：相对路径 → 文件夹显示名 */
const IMPORT_DIRS: { dir: string; folderName: string; files?: string[] }[] = [
  {
    dir: '.',
    folderName: '根目录',
    files: ['principles.md', 'principles-draft.md', 'design-philosophy.md'],
  },
  {
    dir: 'navside',
    folderName: 'NavSide',
  },
  {
    dir: 'krig-markdown',
    folderName: 'Markdown 规范',
  },
  {
    dir: 'ui-framework',
    folderName: 'UI 框架',
  },
  {
    dir: 'docs/block/base',
    folderName: 'Block 基类',
  },
  {
    dir: 'docs/block',
    folderName: 'Block 设计',
  },
  {
    dir: 'docs/code',
    folderName: '代码里程碑',
  },
  {
    dir: 'docs/storage',
    folderName: '存储设计',
  },
  {
    dir: 'docs/test',
    folderName: '测试',
  },
  {
    dir: 'docs/help',
    folderName: 'Help 设计',
  },
  {
    dir: 'docs/math',
    folderName: '数学编辑器',
  },
];

function findMdFiles(dirPath: string, specificFiles?: string[]): { name: string; fullPath: string }[] {
  const results: { name: string; fullPath: string }[] = [];

  if (specificFiles) {
    for (const file of specificFiles) {
      const fullPath = path.join(dirPath, file);
      if (existsSync(fullPath)) {
        results.push({ name: file.replace('.md', ''), fullPath });
      }
    }
    return results;
  }

  // 读取目录中所有 .md 文件
  try {
    const { readdirSync } = require('node:fs');
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push({
          name: entry.name.replace('.md', ''),
          fullPath: path.join(dirPath, entry.name),
        });
      }
    }
  } catch {
    // directory not found
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function initKrigNoteDocs(): Promise<{ created: number }> {
  if (!isDBReady()) return { created: 0 };

  // 检查是否已有 KRIG-Note 文件夹且有内容
  const folders = await folderStore.list();
  const existing = folders.find((f) => f.title === 'KRIG-Note');
  if (existing) {
    // 检查是否有子文件夹（说明已完整导入过）
    const hasChildren = folders.some((f) => f.parent_id === existing.id);
    if (hasChildren) {
      console.log('[InitDocs] KRIG-Note folder already has content, skipping.');
      return { created: 0 };
    }
    // 空文件夹，删掉重建
    await folderStore.delete(existing.id);
  }

  console.log('[InitDocs] Starting KRIG-Note docs import from:', PROJECT_ROOT);
  let created = 0;

  // 创建根文件夹
  const rootFolder = await folderStore.create('KRIG-Note');

  for (const entry of IMPORT_DIRS) {
    const dirPath = path.join(PROJECT_ROOT, entry.dir);
    const mdFiles = findMdFiles(dirPath, entry.files);

    if (mdFiles.length === 0) continue;

    // 创建子文件夹
    const subFolder = await folderStore.create(entry.folderName, rootFolder.id);

    for (const file of mdFiles) {
      try {
        const mdContent = readFileSync(file.fullPath, 'utf-8');
        const title = file.name;
        const docContent = mdToAtoms(mdContent, title);

        const note = await noteStore.create(title, subFolder.id);
        await noteStore.save(note.id, docContent, title);
        created++;
      } catch (err) {
        console.error(`[InitDocs] Failed to import ${file.fullPath}:`, err);
      }
    }

    console.log(`[InitDocs] ${entry.folderName}: ${mdFiles.length} files`);
  }

  // ── 创建 Task 文件夹 + Block 测试任务文档 ──
  const taskFolder = await folderStore.create('Task', rootFolder.id);

  const taskDocContent = buildBlockTaskDocContent(await noteStore.list());
  const taskNote = await noteStore.create('Block 测试工作任务', taskFolder.id);
  await noteStore.save(taskNote.id, taskDocContent, 'Block 测试工作任务');
  created++;
  console.log('[InitDocs] Task folder created with Block test tasks.');

  console.log(`[InitDocs] Done. Created ${created} documents.`);
  return { created };
}

// ── Block 测试任务文档构建（按基类分组） ──

interface NoteListItem { id: string; title: string; folder_id: string | null; updated_at: number; }

const BLOCK_GROUPS: { heading: string; names: string[] }[] = [
  { heading: '基类文档', names: ['base-classes', 'text-block', 'render-block', 'container-block'] },
  { heading: 'RenderBlock 实例', names: ['code-block', 'image', 'math-block', 'video-block', 'audio-block', 'tweet-block'] },
  { heading: 'ContainerBlock 实例', names: ['toggle-list', 'task-list', 'frame-block', 'table', 'column-list'] },
  { heading: 'Inline 节点', names: ['hard-break', 'note-link', 'math-inline'] },
  { heading: '系统设计', names: ['horizontal-rule', 'marks', 'block-action', 'block-relation-model', 'block-selection', 'indent-system', 'container-nesting-design', 'todo-system', 'media-blocks-plan'] },
];

function buildBlockTaskDocContent(allNotes: NoteListItem[]): Atom[] {
  const nameToNote: Record<string, { id: string; title: string }> = {};
  for (const n of allNotes) {
    const normalized = n.title.toLowerCase().replace(/[- ]/g, '');
    nameToNote[normalized] = { id: n.id, title: n.title };
  }

  const atoms: Atom[] = [
    createAtom('noteTitle', {
      children: [{ type: 'text', text: 'Block 测试工作任务' }],
    } as NoteTitleContent),
  ];

  for (const group of BLOCK_GROUPS) {
    atoms.push(createAtom('heading', {
      level: 2,
      children: [{ type: 'text', text: group.heading }],
    } as HeadingContent));

    const listAtom = createAtom('taskList', { listType: 'task' } as ListContent);
    atoms.push(listAtom);

    for (const name of group.names) {
      const normalized = name.toLowerCase().replace(/[- ]/g, '');
      const match = nameToNote[normalized];

      const children = match
        ? [{ type: 'link' as const, href: `krig://note/${match.id}`, children: [{ type: 'text' as const, text: `${name} 优化` }] }]
        : [{ type: 'text' as const, text: `${name} 优化` }];

      const itemAtom = createAtom('taskItem', {
        children,
        checked: false,
      } as ListItemContent);
      itemAtom.parentId = listAtom.id;
      atoms.push(itemAtom);
    }
  }

  atoms.push(createAtom('paragraph', { children: [] } as ParagraphContent));

  atoms.forEach((a, i) => { a.order = i; });
  return atoms;
}

/** 重新导入"测试"文件夹下的所有 .md 文档（增量更新） */
export async function reimportTestDocs(): Promise<boolean> {
  if (!isDBReady()) return false;

  const folders = await folderStore.list();
  const root = folders.find((f) => f.title === 'KRIG-Note');
  if (!root) {
    console.log('[InitDocs] KRIG-Note folder not found. Run Import first.');
    return false;
  }

  // 找到或创建"测试"子文件夹
  let testFolder = folders.find((f) => f.title === '测试' && f.parent_id === root.id);
  if (testFolder) {
    // 删除旧内容
    const allNotes = await noteStore.list();
    for (const note of allNotes) {
      if (note.folder_id === testFolder.id) {
        await noteStore.delete(note.id);
      }
    }
  } else {
    testFolder = await folderStore.create('测试', root.id);
  }

  // 从 docs/test/ 导入所有 .md
  const dirPath = path.join(PROJECT_ROOT, 'docs/test');
  const mdFiles = findMdFiles(dirPath);
  let created = 0;

  for (const file of mdFiles) {
    try {
      const mdContent = readFileSync(file.fullPath, 'utf-8');
      const title = file.name;
      const docContent = mdToAtoms(mdContent, title);
      const note = await noteStore.create(title, testFolder.id);
      await noteStore.save(note.id, docContent, title);
      created++;
    } catch (err) {
      console.error(`[InitDocs] Failed to import ${file.fullPath}:`, err);
    }
  }

  console.log(`[InitDocs] Reimported ${created} test docs.`);
  return true;
}

/** 单独创建 Block 测试任务文档（可在已有 KRIG-Note 文件夹中追加） */
export async function createBlockTaskDoc(): Promise<boolean> {
  if (!isDBReady()) return false;

  const folders = await folderStore.list();
  const root = folders.find((f) => f.title === 'KRIG-Note');
  if (!root) {
    console.log('[InitDocs] KRIG-Note folder not found. Run Import first.');
    return false;
  }

  let taskFolder = folders.find((f) => f.title === 'Task' && f.parent_id === root.id);
  if (!taskFolder) {
    taskFolder = await folderStore.create('Task', root.id);
  }

  const allNotes = await noteStore.list();

  // 已有任务文档则删除重建（确保内容最新）
  const existing = allNotes.find((n) => n.title === 'Block 测试工作任务' && n.folder_id === taskFolder!.id);
  if (existing) {
    await noteStore.delete(existing.id);
  }

  const docContent = buildBlockTaskDocContent(allNotes);
  const note = await noteStore.create('Block 测试工作任务', taskFolder.id);
  await noteStore.save(note.id, docContent, 'Block 测试工作任务');
  console.log('[InitDocs] Block test task doc created.');
  return true;
}
