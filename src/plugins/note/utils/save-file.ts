/**
 * save-file — 通用文件保存工具
 *
 * 通过系统保存对话框让用户选择保存位置和文件名。
 * 底层调用 viewAPI.fileSaveDialog（Electron dialog.showSaveDialog）。
 *
 * 用于：image 导出、audio 下载、video 下载、mermaid 导出等。
 */

const api = () => (window as any).viewAPI;

/** 文件过滤器 */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/** 保存 base64 数据为文件（弹出保存对话框） */
export async function saveBase64File(options: {
  defaultName: string;
  data: string;          // base64 编码
  filters?: FileFilter[];
}): Promise<{ canceled: boolean; filePath?: string }> {
  const viewAPI = api();
  if (!viewAPI?.fileSaveDialog) return { canceled: true };
  return viewAPI.fileSaveDialog(options);
}

/** 保存 Blob 为文件（自动转 base64） */
export async function saveBlobFile(options: {
  defaultName: string;
  blob: Blob;
  filters?: FileFilter[];
}): Promise<{ canceled: boolean; filePath?: string }> {
  const buf = await options.blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return saveBase64File({
    defaultName: options.defaultName,
    data: base64,
    filters: options.filters,
  });
}

/** 保存纯文本为文件 */
export async function saveTextFile(options: {
  defaultName: string;
  text: string;
  filters?: FileFilter[];
}): Promise<{ canceled: boolean; filePath?: string }> {
  const base64 = btoa(unescape(encodeURIComponent(options.text)));
  return saveBase64File({
    defaultName: options.defaultName,
    data: base64,
    filters: options.filters,
  });
}

/** 从 URL 下载文件（弹出保存对话框让用户选位置） */
export async function saveUrlFile(options: {
  url: string;
  defaultName: string;
  filters?: FileFilter[];
}): Promise<{ canceled: boolean; filePath?: string }> {
  try {
    const response = await fetch(options.url);
    if (!response.ok) return { canceled: true };
    const blob = await response.blob();
    return saveBlobFile({
      defaultName: options.defaultName,
      blob,
      filters: options.filters,
    });
  } catch {
    return { canceled: true };
  }
}

/** 从 data URI 保存文件 */
export async function saveDataUriFile(options: {
  dataUri: string;
  defaultName: string;
  filters?: FileFilter[];
}): Promise<{ canceled: boolean; filePath?: string }> {
  // data:image/png;base64,xxxx → 提取 base64 部分
  const match = options.dataUri.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) return { canceled: true };
  return saveBase64File({
    defaultName: options.defaultName,
    data: match[1],
    filters: options.filters,
  });
}

/** 在 Finder 中显示文件 */
export function showInFinder(filePath: string): void {
  api()?.showItemInFolder?.(filePath);
}

// ── 常用文件过滤器 ──

export const IMAGE_FILTERS: FileFilter[] = [
  { name: 'PNG Image', extensions: ['png'] },
  { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
  { name: 'WebP Image', extensions: ['webp'] },
];

export const AUDIO_FILTERS: FileFilter[] = [
  { name: 'MP3 Audio', extensions: ['mp3'] },
  { name: 'OGG Audio', extensions: ['ogg'] },
  { name: 'WAV Audio', extensions: ['wav'] },
];

export const VIDEO_FILTERS: FileFilter[] = [
  { name: 'MP4 Video', extensions: ['mp4'] },
  { name: 'WebM Video', extensions: ['webm'] },
];

export const SVG_FILTERS: FileFilter[] = [
  { name: 'SVG Image', extensions: ['svg'] },
];
