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

  console.log(`[InitDocs] Done. Created ${created} documents.`);
  return { created };
}
