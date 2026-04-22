import { IPC } from '../../shared/types';
import type { ProgressStartPayload, ProgressUpdatePayload, ProgressDonePayload } from '../../shared/types';
import { showOverlay, hideOverlay, sendToOverlay } from './shell';

/**
 * 运行一个长耗时任务，期间显示全屏进度遮罩。
 *
 * @param title 显示在遮罩标题
 * @param task  任务函数，接收 reportProgress 回调
 * @param options.keepOnDone 完成后保留遮罩给用户看结果（默认 true，用户需手动点关闭）
 */
export async function runWithProgress<T>(
  title: string,
  task: (reportProgress: (message: string, current?: number, total?: number) => void) => Promise<T>,
  options: { keepOnDone?: boolean; doneMessage?: (result: T) => { success: boolean; message: string } } = {},
): Promise<T> {
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { keepOnDone = true, doneMessage } = options;

  // Start
  const startPayload: ProgressStartPayload = { taskId, title, indeterminate: true };
  await showOverlay();
  // 等一个 tick 让 overlay 挂载完成，避免丢失 start 事件
  await new Promise((r) => setTimeout(r, 100));
  sendToOverlay(IPC.PROGRESS_START, startPayload);

  const reportProgress = (message: string, current?: number, total?: number) => {
    const payload: ProgressUpdatePayload = { taskId, message, current, total };
    sendToOverlay(IPC.PROGRESS_UPDATE, payload);
  };

  try {
    const result = await task(reportProgress);
    const done = doneMessage ? doneMessage(result) : { success: true, message: '完成' };
    const donePayload: ProgressDonePayload = { taskId, success: done.success, message: done.message };
    sendToOverlay(IPC.PROGRESS_DONE, donePayload);

    if (!keepOnDone) {
      setTimeout(() => hideOverlay(), 300);
    } else {
      // 监听关闭：由用户点关闭按钮时 renderer 会清 state，这里等 3 秒兜底自动关闭
      setTimeout(() => hideOverlay(), 3000);
    }

    return result;
  } catch (err) {
    const donePayload: ProgressDonePayload = {
      taskId,
      success: false,
      message: `失败：${(err as Error)?.message ?? String(err)}`,
    };
    sendToOverlay(IPC.PROGRESS_DONE, donePayload);
    setTimeout(() => hideOverlay(), 3000);
    throw err;
  }
}
