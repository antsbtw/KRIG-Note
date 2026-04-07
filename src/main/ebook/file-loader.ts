import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * eBook 文件加载器
 *
 * 职责：读取电子书文件到 Buffer、管理当前文件状态。
 * 文件对话框由 IPC handler（IMPORT）负责，此模块只做纯文件加载。
 */

interface EBookFileState {
  filePath: string;
  fileName: string;
  buffer: Buffer;
}

let currentFile: EBookFileState | null = null;

/** 加载指定路径的电子书 */
export async function loadEBook(filePath: string): Promise<{
  filePath: string;
  fileName: string;
}> {
  const buffer = await readFile(filePath);
  const fileName = path.basename(filePath);

  currentFile = { filePath, fileName, buffer };

  return { filePath, fileName };
}

/** 获取当前电子书数据 */
export function getEBookData(): { filePath: string; fileName: string; data: Buffer } | null {
  if (!currentFile) return null;
  const { filePath, fileName, buffer } = currentFile;
  // 直接返回 Buffer，Electron IPC 会自动序列化
  // renderer 侧收到的是 Uint8Array（structured clone 的结果）
  return { filePath, fileName, data: buffer };
}

/** 关闭当前电子书，释放 Buffer */
export function closeEBook(): void {
  currentFile = null;
}
