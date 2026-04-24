import type { BaseWindow } from 'electron';
import { IPC } from '../../shared/types';

/**
 * Slot 位置锁：session 级状态，默认 false（联动态）。
 *
 * 作用：left slot 滚动时会向 right slot 发 anchor-sync 消息（"左主右从"），
 * 锁定后发送端会跳过这条消息，两侧位置各自独立。
 *
 * 不持久化 —— 进程重启即回到 false。
 */
let locked = false;

export function getSlotLock(): boolean {
  return locked;
}

export function setSlotLock(next: boolean, mainWindow: BaseWindow | null): void {
  if (locked === next) return;
  locked = next;
  if (!mainWindow) return;
  for (const child of mainWindow.contentView.children) {
    if ('webContents' in child) {
      (child as any).webContents.send(IPC.SLOT_LOCK_CHANGED, locked);
    }
  }
}
