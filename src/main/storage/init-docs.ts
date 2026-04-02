import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { folderStore } from './folder-store';
import { noteStore } from './note-store';
import { isDBReady } from './client';
import { mdToDocContent } from './md-to-pm';

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
        const docContent = mdToDocContent(mdContent, title);

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

  // 查找 Block 设计文件夹中的笔记，构建 noteLink 引用
  const allNotes = await noteStore.list();
  const blockNames = [
    'noteTitle', 'paragraph', 'heading', 'codeBlock', 'blockquote', 'horizontalRule',
    'hardBreak', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
    'toggleList', 'callout', 'image', 'table', 'noteLink', 'mathBlock', 'mathInline',
    'columnList', 'frameBlock', 'audioBlock', 'videoBlock', 'tweetBlock',
    'marks', 'block-action', 'toggle-heading', 'math-visual', 'translation-block',
  ];

  // 文件名到 noteId 的映射
  const nameToNote: Record<string, { id: string; title: string }> = {};
  for (const n of allNotes) {
    // 匹配文件名（去掉连字符转换）
    const normalized = n.title.toLowerCase().replace(/[- ]/g, '');
    nameToNote[normalized] = { id: n.id, title: n.title };
  }

  // 构建 taskItem 列表（每个 Block 一个 task + noteLink）
  const taskItems: unknown[] = [];
  for (const name of blockNames) {
    const normalized = name.toLowerCase().replace(/[- ]/g, '');
    const match = nameToNote[normalized];

    const content: unknown[] = [];
    if (match) {
      // 有对应文档 → 带 noteLink
      content.push({
        type: 'paragraph',
        content: [
          { type: 'text', text: `${name} 优化`, marks: [{ type: 'link', attrs: { href: `krig://note/${match.id}`, title: match.title } }] },
        ],
      });
    } else {
      // 没有对应文档 → 纯文字
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: `${name} 优化` }],
      });
    }

    taskItems.push({
      type: 'taskItem',
      attrs: { checked: false },
      content,
    });
  }

  const taskDocContent = [
    { type: 'noteTitle', content: [{ type: 'text', text: 'Block 测试工作任务' }] },
    { type: 'taskList', content: taskItems },
    { type: 'paragraph' },
  ];

  const taskNote = await noteStore.create('Block 测试工作任务', taskFolder.id);
  await noteStore.save(taskNote.id, taskDocContent, 'Block 测试工作任务');
  created++;
  console.log('[InitDocs] Task folder created with Block test tasks.');

  console.log(`[InitDocs] Done. Created ${created} documents.`);
  return { created };
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

  // 检查是否已有 Task 文件夹
  let taskFolder = folders.find((f) => f.title === 'Task' && f.parent_id === root.id);
  if (!taskFolder) {
    taskFolder = await folderStore.create('Task', root.id);
  }

  // 查找所有笔记
  const allNotes = await noteStore.list();

  // 已有任务文档则跳过
  if (allNotes.some((n) => n.title === 'Block 测试工作任务' && n.folder_id === taskFolder!.id)) {
    console.log('[InitDocs] Block test task doc already exists.');
    return false;
  }

  const blockNames = [
    'note-title', 'paragraph', 'heading', 'code-block', 'blockquote', 'horizontal-rule',
    'hard-break', 'bullet-list', 'ordered-list', 'list-item', 'task-list', 'task-item',
    'toggle-list', 'toggle-heading', 'callout', 'image', 'table', 'note-link',
    'math-block', 'math-inline', 'math-visual', 'column-list', 'frame-block',
    'audio-block', 'video-block', 'tweet-block', 'translation-block',
    'marks', 'block-action',
  ];

  // 构建 taskItem 列表
  const taskItems: unknown[] = [];
  for (const name of blockNames) {
    const match = allNotes.find((n) => n.title === name);

    const paraContent: unknown[] = [];
    if (match) {
      paraContent.push({
        type: 'text',
        text: `${name} 优化`,
        marks: [{ type: 'link', attrs: { href: `krig://note/${match.id}`, title: match.title } }],
      });
    } else {
      paraContent.push({ type: 'text', text: `${name} 优化` });
    }

    taskItems.push({
      type: 'taskItem',
      attrs: { checked: false },
      content: [{ type: 'paragraph', content: paraContent }],
    });
  }

  const docContent = [
    { type: 'noteTitle', content: [{ type: 'text', text: 'Block 测试工作任务' }] },
    { type: 'taskList', content: taskItems },
    { type: 'paragraph' },
  ];

  const note = await noteStore.create('Block 测试工作任务', taskFolder.id);
  await noteStore.save(note.id, docContent, 'Block 测试工作任务');
  console.log('[InitDocs] Block test task doc created.');
  return true;
}
