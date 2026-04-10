import path from 'node:path';
import fs from 'node:fs';
import { app, WebContents } from 'electron';
import { importExtractionData } from '../../../main/extraction/import-service';
import { setPendingNoteId } from '../../../main/ipc/handlers';
import { openRightSlot } from '../../../main/window/shell';

/**
 * Extraction 下载拦截器
 *
 * 拦截 Extraction 变种 WebView 中的 JSON 下载，
 * 解析并导入到 Note 系统。
 */
export function setupExtractionInterceptor(guestWebContents: WebContents): void {
  guestWebContents.session.on('will-download', (_event, item) => {
    const fileName = item.getFilename();
    console.log('[Extraction] Download intercepted:', fileName, item.getURL());

    // 只拦截 JSON 文件（Atom 提取结果）
    if (!fileName.endsWith('.json')) return;

    // 保存到临时文件，读取后导入 Note
    const tmpPath = path.join(
      app.getPath('temp'),
      `krig-extraction-${Date.now()}.json`,
    );
    item.setSavePath(tmpPath);

    item.on('done', async (_e, state) => {
      if (state !== 'completed') {
        console.error('[Extraction] Download failed:', state);
        return;
      }

      try {
        const jsonStr = fs.readFileSync(tmpPath, 'utf-8');
        const data = JSON.parse(jsonStr);
        // 从文件名解析书名和页码范围
        // 格式: "BookName.pdf_p20-20.json"
        let bookName = fileName.replace(/\.json$/, '');
        const pageMatch = bookName.match(/_p(\d+-\d+)$/);
        const pageRange = pageMatch ? pageMatch[1] : '';
        bookName = bookName.replace(/\.pdf_p\d+-\d+$/, '').replace(/\.pdf$/, '');

        // 注入解析的元数据到 data 对象
        if (!data.bookName) data.bookName = bookName;
        if (!data.pageRange) data.pageRange = pageRange;

        console.log('[Extraction] Downloaded JSON:', bookName, 'pages:', pageRange, '- importing...');

        // 导入（创建文件夹 + Note）
        const result = await importExtractionData(data);
        // 设置 pending noteId（NoteEditor 初始化完成后会拉取）
        setPendingNoteId(result.noteId);

        // Right Slot 切换为 NoteView
        openRightSlot('demo-a');

        // 清理临时文件
        fs.unlinkSync(tmpPath);
      } catch (err) {
        console.error('[Extraction] Import failed:', err);
      }
    });
  });
}
