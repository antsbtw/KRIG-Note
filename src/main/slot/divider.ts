import { ipcMain, IpcMainEvent, BaseWindow } from 'electron';
import { IPC } from '../../shared/types';
import { APP_CONFIG } from '../../shared/app-config';
import { workspaceManager } from '../workspace/manager';
import { updateLayout } from '../window/shell';
import { getNavSideWidth } from './layout';

/**
 * Divider 拖拽控制器
 *
 * 监听 divider renderer 的拖拽事件，计算新的 dividerRatio，更新布局。
 */

let isDragging = false;
let lastMouseX = 0;
let getWindow: (() => BaseWindow | null) | null = null;

export function setupDividerController(getMainWindow: () => BaseWindow | null): void {
  getWindow = getMainWindow;

  ipcMain.on(IPC.DIVIDER_DRAG_START, (_event: IpcMainEvent, screenX: number) => {
    isDragging = true;
    lastMouseX = screenX;
  });

  ipcMain.on(IPC.DIVIDER_DRAG_MOVE, (_event: IpcMainEvent, screenX: number) => {
    if (!isDragging || !getWindow) return;
    const mainWindow = getWindow();
    if (!mainWindow) return;

    const deltaX = screenX - lastMouseX;
    lastMouseX = screenX;
    if (deltaX === 0) return;

    const active = workspaceManager.getActive();
    if (!active) return;

    // 计算新的 dividerRatio
    const { width: windowWidth } = mainWindow.getContentBounds();
    const navSideWidth = active.navSideVisible ? getNavSideWidth() : APP_CONFIG.layout.toggleWidth;
    const slotAreaWidth = windowWidth - navSideWidth;
    if (slotAreaWidth <= 0) return;

    const currentRatio = active.dividerRatio;
    const deltaRatio = deltaX / slotAreaWidth;
    const { dividerRatioMin, dividerRatioMax } = APP_CONFIG.workspace;
    const newRatio = Math.max(dividerRatioMin, Math.min(dividerRatioMax, currentRatio + deltaRatio));

    workspaceManager.update(active.id, { dividerRatio: newRatio });
    updateLayout();
  });

  ipcMain.on(IPC.DIVIDER_DRAG_END, () => {
    isDragging = false;
  });
}

/** Divider 的 inline HTML */
export const DIVIDER_HTML = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; }
  html, body {
    height: 100%;
    overflow: hidden;
    background: #2a2a2a;
    cursor: col-resize;
    user-select: none;
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .handle {
    width: 2px;
    height: 32px;
    background: #555;
    border-radius: 1px;
  }
  body:hover { background: #3a3a3a; }
  body:hover .handle { background: #888; }
  body:active, body.dragging { background: #444; }
</style></head>
<body>
  <div class="handle"></div>
<script>
  var dragging = false;
  document.addEventListener('mousedown', function(e) {
    dragging = true;
    document.body.classList.add('dragging');
    window.dividerAPI.onDragStart(e.screenX);
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    window.dividerAPI.onDragMove(e.screenX);
  });
  document.addEventListener('mouseup', function(e) {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging');
    window.dividerAPI.onDragEnd(e.screenX);
  });
  document.addEventListener('mouseleave', function(e) {
    if (!dragging) return;
    window.dividerAPI.onDragMove(e.screenX);
  });
</script>
</body>
</html>`;
