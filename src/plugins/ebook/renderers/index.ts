import type { EBookFileType, IBookRenderer } from '../types';
import { PDFRenderer } from './pdf';
import { EPUBRenderer } from './epub';

/**
 * 渲染引擎工厂
 *
 * 根据文件格式创建对应的渲染引擎实例。
 * 新增格式只需：1. 实现 IFixedPageRenderer 或 IReflowableRenderer  2. 在此注册
 */
export function createRenderer(fileType: EBookFileType): IBookRenderer {
  switch (fileType) {
    case 'pdf':
      return new PDFRenderer();

    case 'epub':
      return new EPUBRenderer();

    case 'djvu':
      throw new Error('DjVu renderer not yet implemented');

    case 'cbz':
      throw new Error('CBZ renderer not yet implemented');

    default:
      throw new Error(`Unknown file type: ${fileType}`);
  }
}
