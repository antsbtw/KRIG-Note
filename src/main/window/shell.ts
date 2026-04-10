import { BaseWindow, WebContentsView } from 'electron';
import path from 'node:path';
import { calculateLayout } from '../slot/layout';
import { workspaceManager } from '../workspace/manager';
import { workModeRegistry } from '../workmode/registry';
import { protocolRegistry } from '../protocol/registry';
import { DIVIDER_HTML } from '../slot/divider';
import { IPC } from '../../shared/types';
import type { WorkspaceId, ViewType, ViewTypeRendererConfig } from '../../shared/types';

/**
 * Shell — 应用的主窗口
 *
 * 布局结构（双栏时）：
 * ┌─ Toggle ─┬─ WorkspaceBar ──────────────────────────┐
 * ├─ NavSide ─┤─ Left Slot ──┤D├── Right Slot ────────┤
 * │           │              │i│                        │
 * └───────────┴──────────────┴v┴────────────────────────┘
 *
 * View 实例池按 Workspace 隔离。
 */

let mainWindow: BaseWindow | null = null;
let toggleView: WebContentsView | null = null;
let shellView: WebContentsView | null = null;
let navSideView: WebContentsView | null = null;
let navResizeView: WebContentsView | null = null;
let dividerView: WebContentsView | null = null;

// ── Workspace 隔离的 View 实例池 ──

interface WorkspaceViewPool {
  leftViews: Map<string, WebContentsView>;   // workModeId → Left View
  rightView: WebContentsView | null;          // Right Slot View（当前只支持一个）
  rightWorkModeId: string | null;             // Right View 的 workModeId
  activeLeftId: string | null;                // 当前 Left Slot 显示的 workModeId
}

const workspaceViewPools: Map<WorkspaceId, WorkspaceViewPool> = new Map();

function getViewPool(workspaceId: WorkspaceId): WorkspaceViewPool {
  let pool = workspaceViewPools.get(workspaceId);
  if (!pool) {
    pool = { leftViews: new Map(), rightView: null, rightWorkModeId: null, activeLeftId: null };
    workspaceViewPools.set(workspaceId, pool);
  }
  return pool;
}

/** ViewType → 渲染器配置映射 */
const viewTypeRenderers: Record<ViewType | 'default', ViewTypeRendererConfig> = {
  note:  { devServerUrl: NOTE_VIEW_VITE_DEV_SERVER_URL,  htmlFile: 'note.html',      prodDir: 'note_view' },
  ebook: { devServerUrl: EBOOK_VIEW_VITE_DEV_SERVER_URL, htmlFile: 'ebook.html',     prodDir: 'ebook_view' },
  web:   { devServerUrl: WEB_VIEW_VITE_DEV_SERVER_URL,   htmlFile: 'web.html',       prodDir: 'web_view',   webPreferences: { webviewTag: true } },
  graph: { devServerUrl: DEMO_VIEW_VITE_DEV_SERVER_URL,  htmlFile: 'demo-view.html', prodDir: 'demo_view' },
  default: { devServerUrl: DEMO_VIEW_VITE_DEV_SERVER_URL, htmlFile: 'demo-view.html', prodDir: 'demo_view' },
};

/** 懒创建 View 实例 — 根据 WorkMode 的 viewType 选择 renderer */
function createViewForWorkMode(workModeId: string): WebContentsView {
  const mode = workModeRegistry.get(workModeId);
  const viewType = mode?.viewType ?? 'note';
  const config = viewTypeRenderers[viewType] ?? viewTypeRenderers.default;

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'view.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: config.webPreferences?.webviewTag ?? false,
    },
  });
  view.setBackgroundColor('#1e1e1e');

  // 构建查询参数
  const variant = mode?.variant ?? '';
  const query: Record<string, string> = { workModeId };
  if (variant) query.variant = variant;

  // 加载 renderer
  if (config.devServerUrl) {
    const params = new URLSearchParams(query).toString();
    view.webContents.loadURL(`${config.devServerUrl}/${config.htmlFile}?${params}`);
  } else {
    view.webContents.loadFile(
      path.join(__dirname, `../renderer/${config.prodDir}/${config.htmlFile}`),
      { query },
    );
  }

  // webviewTag 启用时，拦截 guest 弹窗
  if (config.webPreferences?.webviewTag) {
    view.webContents.on('did-attach-webview', (_event, guestWebContents) => {
      // 弹窗策略：target=_blank → 内部导航，OAuth → 允许子窗口
      guestWebContents.setWindowOpenHandler(({ url, disposition }) => {
        if (!url || url === 'about:blank') return { action: 'allow' };
        if (disposition === 'foreground-tab' || disposition === 'background-tab') {
          guestWebContents.loadURL(url);
          return { action: 'deny' };
        }
        return { action: 'allow' };
      });

      // 调用插件注册的 onViewCreated hook
      mode?.onViewCreated?.(view, guestWebContents);
    });
  }

  mainWindow?.contentView.addChildView(view);
  view.setVisible(false);
  return view;
}

// ── 公开 API ──

export function getMainWindow(): BaseWindow | null {
  return mainWindow;
}

/** 切换 Left Slot 的 View（WorkMode 切换时调用） */
export function switchLeftSlotView(workModeId: string): void {
  if (!mainWindow) return;
  const active = workspaceManager.getActive();
  if (!active) return;

  const pool = getViewPool(active.id);

  // 隐藏旧 Left View
  if (pool.activeLeftId && pool.activeLeftId !== workModeId) {
    const oldView = pool.leftViews.get(pool.activeLeftId);
    if (oldView) oldView.setVisible(false);
  }

  // 显示/创建新 Left View
  let newView = pool.leftViews.get(workModeId);
  if (!newView) {
    newView = createViewForWorkMode(workModeId);
    pool.leftViews.set(workModeId, newView);
  }
  newView.setVisible(true);
  pool.activeLeftId = workModeId;

  // 同步 slotBinding.left 到 WorkspaceState
  workspaceManager.update(active.id, {
    slotBinding: { ...active.slotBinding, left: workModeId },
  });

  updateLayout();
}

/** 打开 Right Slot */
export function openRightSlot(workModeId: string): WebContentsView | null {
  if (!mainWindow) return null;
  const active = workspaceManager.getActive();
  if (!active) return null;

  const pool = getViewPool(active.id);

  // 如果已有 Right View 且是同一个 workModeId，关闭它（toggle 行为）
  if (pool.rightView && pool.rightWorkModeId === workModeId) {
    closeRightSlot();
    return null;
  }

  // 关闭旧的 Right View
  if (pool.rightView) {
    pool.rightView.setVisible(false);
    mainWindow.contentView.removeChildView(pool.rightView);
    pool.rightView.webContents.close();
  }

  // 创建新的 Right View
  pool.rightView = createViewForWorkMode(workModeId);
  pool.rightWorkModeId = workModeId;
  pool.rightView.setVisible(true);

  // 同步 slotBinding.right 到 WorkspaceState
  workspaceManager.update(active.id, {
    slotBinding: { ...active.slotBinding, right: workModeId },
  });

  // 诊断：监听 renderer 崩溃
  pool.rightView.webContents.on('render-process-gone', (_e, details) => {
    console.error('[RightSlot] Renderer process gone:', details.reason, details.exitCode);
  });
  pool.rightView.webContents.on('unresponsive', () => {
    console.error('[RightSlot] Renderer became unresponsive');
  });
  pool.rightView.webContents.on('responsive', () => {
    console.log('[RightSlot] Renderer became responsive again');
  });

  // 显示 Divider
  ensureDivider();
  dividerView?.setVisible(true);

  updateLayout();
  return pool.rightView;
}

/** 关闭 Right Slot */
export function closeRightSlot(): void {
  if (!mainWindow) return;
  const active = workspaceManager.getActive();
  if (!active) return;

  const pool = getViewPool(active.id);

  if (pool.rightView) {
    pool.rightView.setVisible(false);
    mainWindow.contentView.removeChildView(pool.rightView);
    pool.rightView.webContents.close();
    pool.rightView = null;
    pool.rightWorkModeId = null;
  }

  // 同步 slotBinding.right 到 WorkspaceState
  workspaceManager.update(active.id, {
    slotBinding: { ...active.slotBinding, right: null },
  });

  // 隐藏 Divider
  dividerView?.setVisible(false);

  updateLayout();
}

/** 切换 Workspace */
export function switchWorkspace(oldId: WorkspaceId | null, newId: WorkspaceId): void {
  if (!mainWindow) return;

  // 隐藏旧 Workspace 所有 View
  if (oldId) {
    const oldPool = workspaceViewPools.get(oldId);
    if (oldPool) {
      for (const view of oldPool.leftViews.values()) view.setVisible(false);
      if (oldPool.rightView) oldPool.rightView.setVisible(false);
    }
  }

  // 隐藏 Divider（新 Workspace 可能没有 Right Slot）
  dividerView?.setVisible(false);

  // 显示新 Workspace 的 View
  const newWorkspace = workspaceManager.get(newId);
  if (newWorkspace) {
    const pool = getViewPool(newId);
    if (pool.activeLeftId) {
      const leftView = pool.leftViews.get(pool.activeLeftId);
      if (leftView) leftView.setVisible(true);
    } else {
      switchLeftSlotView(newWorkspace.workModeId);
    }

    // 恢复 Right Slot
    if (pool.rightView) {
      pool.rightView.setVisible(true);
      ensureDivider();
      dividerView?.setVisible(true);
    } else if (newWorkspace.slotBinding?.right) {
      // 首次切换到此 workspace，从 slotBinding 恢复右槽
      const rightModeId = newWorkspace.slotBinding.right;
      if (workModeRegistry.get(rightModeId)) {
        openRightSlot(rightModeId);
      }
    }
  }

  updateLayout();
}

/** 关闭 Workspace 的所有 View */
export function closeWorkspaceViews(workspaceId: WorkspaceId): void {
  if (!mainWindow) return;
  const pool = workspaceViewPools.get(workspaceId);
  if (!pool) return;

  for (const view of pool.leftViews.values()) {
    if (mainWindow.contentView.children.includes(view)) {
      mainWindow.contentView.removeChildView(view);
    }
    view.webContents.close();
  }

  if (pool.rightView) {
    if (mainWindow.contentView.children.includes(pool.rightView)) {
      mainWindow.contentView.removeChildView(pool.rightView);
    }
    pool.rightView.webContents.close();
  }

  workspaceViewPools.delete(workspaceId);
}

/** 根据 webContentsId 判断 View 在哪个 slot（用于 SLOT_CLOSE 自动检测） */
export function getSlotBySenderId(senderId: number): 'left' | 'right' | null {
  const active = workspaceManager.getActive();
  if (!active) return null;
  const pool = workspaceViewPools.get(active.id);
  if (!pool) return null;
  if (pool.activeLeftId) {
    const leftView = pool.leftViews.get(pool.activeLeftId);
    if (leftView?.webContents.id === senderId) return 'left';
  }
  if (pool.rightView?.webContents.id === senderId) return 'right';
  return null;
}

/** 关闭指定 side 的 slot — 对面 View 自动全屏 */
export function closeSlot(side: 'left' | 'right'): void {
  if (side === 'right') {
    closeRightSlot();
    return;
  }
  // 关闭 left → right 晋升为 left
  if (!mainWindow) return;
  const active = workspaceManager.getActive();
  if (!active) return;
  const pool = getViewPool(active.id);
  if (!pool.rightView || !pool.rightWorkModeId) return;

  // 销毁 left view
  if (pool.activeLeftId) {
    const leftView = pool.leftViews.get(pool.activeLeftId);
    if (leftView) {
      leftView.setVisible(false);
      mainWindow.contentView.removeChildView(leftView);
      leftView.webContents.close();
    }
    pool.leftViews.delete(pool.activeLeftId);
  }
  // right 晋升为 left
  const promotedView = pool.rightView;
  const promotedModeId = pool.rightWorkModeId;
  pool.leftViews.set(promotedModeId, promotedView);
  pool.activeLeftId = promotedModeId;
  pool.rightView = null;
  pool.rightWorkModeId = null;
  workspaceManager.update(active.id, { workModeId: promotedModeId });
  dividerView?.setVisible(false);
  updateLayout();
}

/** 获取当前 Workspace 是否有 Right Slot */
export function hasRightSlot(): boolean {
  const active = workspaceManager.getActive();
  if (!active) return false;
  const pool = workspaceViewPools.get(active.id);
  return pool?.rightView !== null && pool?.rightView !== undefined;
}

/** 获取当前活跃的 Left 和 Right View 的 webContents ID（用于消息路由） */
export function getActiveViewWebContentsIds(): { leftId: number | null; rightId: number | null } {
  const active = workspaceManager.getActive();
  if (!active) return { leftId: null, rightId: null };
  const pool = workspaceViewPools.get(active.id);
  if (!pool) return { leftId: null, rightId: null };

  const leftView = pool.activeLeftId ? pool.leftViews.get(pool.activeLeftId) : null;
  return {
    leftId: leftView?.webContents.id ?? null,
    rightId: pool.rightView?.webContents.id ?? null,
  };
}

/**
 * 获取当前 Workspace 的活跃协同协议（宽松模式）
 *
 * 查协议注册表：(Left.type+variant, Right.type+variant) → 协议 id 或 null
 * null = 不允许通信，消息不转发
 * 非 null = 允许通信，所有消息都转发（不检查 message.protocol）
 */
export function getActiveProtocol(): string | null {
  const active = workspaceManager.getActive();
  if (!active) return null;
  const pool = workspaceViewPools.get(active.id);
  if (!pool || !pool.activeLeftId || !pool.rightWorkModeId) return null;

  // 从 WorkMode 注册表获取 ViewType + variant
  const leftMode = workModeRegistry.get(pool.activeLeftId);
  const rightMode = workModeRegistry.get(pool.rightWorkModeId);
  if (!leftMode || !rightMode) return null;

  return protocolRegistry.match(
    { type: leftMode.viewType, variant: leftMode.variant },
    { type: rightMode.viewType, variant: rightMode.variant },
  );
}

// ── Divider 管理 ──

function ensureDivider(): void {
  if (dividerView) return;
  dividerView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'divider.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  dividerView.setBackgroundColor('#2a2a2a');
  dividerView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DIVIDER_HTML)}`);
  mainWindow?.contentView.addChildView(dividerView);
  dividerView.setVisible(false);
}

// ── Shell 创建 ──

export function createShell(): BaseWindow {
  mainWindow = new BaseWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    backgroundColor: '#1e1e1e',
  });

  toggleView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'shell.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  toggleView.setBackgroundColor('#1e1e1e');
  toggleView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(TOGGLE_HTML)}`);

  shellView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'shell.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  shellView.setBackgroundColor('#1e1e1e');

  navSideView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'navside.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  navSideView.setBackgroundColor('#1a1a1a');

  // NavSide Resize Handle — 独立 WebContentsView（右边缘拖拽条）
  navResizeView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'navside.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  navResizeView.setBackgroundColor('#1a1a1a');
  navResizeView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(NAV_RESIZE_HTML)}`);

  mainWindow.contentView.addChildView(toggleView);
  mainWindow.contentView.addChildView(shellView);
  mainWindow.contentView.addChildView(navSideView);
  mainWindow.contentView.addChildView(navResizeView);

  if (SHELL_VITE_DEV_SERVER_URL) {
    shellView.webContents.loadURL(`${SHELL_VITE_DEV_SERVER_URL}/shell.html`);
  } else {
    shellView.webContents.loadFile(path.join(__dirname, `../renderer/shell/shell.html`));
  }

  if (NAVSIDE_VITE_DEV_SERVER_URL) {
    navSideView.webContents.loadURL(`${NAVSIDE_VITE_DEV_SERVER_URL}/navside.html`);
  } else {
    navSideView.webContents.loadFile(path.join(__dirname, `../renderer/navside/navside.html`));
  }

  updateLayout();

  // 初始化 Left Slot View
  const active = workspaceManager.getActive();
  const workModeId = active?.workModeId || workModeRegistry.getDefault()?.id;
  console.log('[Shell] Active workspace:', active?.id, 'workModeId:', workModeId);
  if (workModeId) {
    // 确保 workspace 有 workModeId（Session 恢复时可能丢失）
    if (active && !active.workModeId) {
      workspaceManager.update(active.id, { workModeId });
    }
    switchLeftSlotView(workModeId);
  }

  // 恢复 Right Slot（如果 Session 中有 slotBinding.right）
  if (active?.slotBinding?.right) {
    const rightModeId = active.slotBinding.right;
    if (workModeRegistry.get(rightModeId)) {
      openRightSlot(rightModeId);
    }
  }

  mainWindow.on('resize', () => updateLayout());
  mainWindow.on('enter-full-screen', () => updateLayout());
  mainWindow.on('leave-full-screen', () => updateLayout());

  mainWindow.on('closed', () => {
    mainWindow = null;
    toggleView = null;
    shellView = null;
    navSideView = null;
    navResizeView = null;
    dividerView = null;
    workspaceViewPools.clear();
  });

  return mainWindow;
}

/** 根据当前 Workspace 状态更新所有 View 的布局 */
export function updateLayout(): void {
  if (!mainWindow || !toggleView || !shellView || !navSideView) return;

  const { width: windowWidth, height: windowHeight } = mainWindow.getContentBounds();
  const active = workspaceManager.getActive();

  const navSideVisible = active?.navSideVisible ?? true;
  const rightSlotOpen = hasRightSlot();
  const dividerRatio = active?.dividerRatio ?? 0.5;

  const isFullScreen = mainWindow.isFullScreen();
  const wsNavSideWidth = active?.navSideWidth ?? undefined;
  const layout = calculateLayout(windowWidth, windowHeight, navSideVisible, rightSlotOpen, dividerRatio, isFullScreen, wsNavSideWidth);

  toggleView.setBounds(layout.toggle);
  shellView.setBounds(layout.workspaceBar);

  if (layout.navSide) {
    navSideView.setBounds(layout.navSide);
    navSideView.setVisible(true);
    // NavSide resize handle: 4px 宽，紧贴 NavSide 右边缘，全高
    if (navResizeView) {
      navResizeView.setBounds({
        x: layout.navSide.x + layout.navSide.width - 2,
        y: layout.navSide.y,
        width: 4,
        height: layout.navSide.height,
      });
      navResizeView.setVisible(true);
    }
  } else {
    navSideView.setVisible(false);
    navResizeView?.setVisible(false);
  }

  // Left Slot
  if (active) {
    const pool = workspaceViewPools.get(active.id);
    if (pool?.activeLeftId) {
      const leftView = pool.leftViews.get(pool.activeLeftId);
      if (leftView) {
        leftView.setBounds(layout.leftSlot);
      }
    }

    // Right Slot + Divider
    if (pool?.rightView && layout.rightSlot && layout.divider) {
      pool.rightView.setBounds(layout.rightSlot);
      if (dividerView) dividerView.setBounds(layout.divider);
    }
  }
}

// Toggle inline HTML
const TOGGLE_HTML = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1e1e1e;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    -webkit-app-region: drag;
  }
  button {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: #999;
    font-size: 14px;
    cursor: pointer;
    border-radius: 4px;
    -webkit-app-region: no-drag;
  }
  button:hover { background: #333; color: #e8eaed; }
</style></head>
<body>
  <button onclick="window.shellAPI?.toggleNavSide()" title="Toggle NavSide">☰</button>
</body>
</html>`;

// NavSide resize handle inline HTML
const NAV_RESIZE_HTML = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; }
  html, body {
    height: 100%;
    overflow: hidden;
    background: transparent;
    cursor: col-resize;
    user-select: none;
  }
  body:hover { background: rgba(255,255,255,0.06); }
  body:active, body.dragging { background: rgba(255,255,255,0.1); }
</style></head>
<body>
<script>
  var dragging = false;
  document.addEventListener('mousedown', function(e) {
    dragging = true;
    document.body.classList.add('dragging');
    window.navSideAPI.resizeStart(e.screenX);
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    window.navSideAPI.resizeMove(e.screenX);
  });
  document.addEventListener('mouseup', function(e) {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging');
    window.navSideAPI.resizeEnd();
  });
  document.addEventListener('mouseleave', function(e) {
    if (!dragging) return;
    window.navSideAPI.resizeMove(e.screenX);
  });
</script>
</body>
</html>`;

declare const SHELL_VITE_DEV_SERVER_URL: string | undefined;
declare const NAVSIDE_VITE_DEV_SERVER_URL: string | undefined;
declare const DEMO_VIEW_VITE_DEV_SERVER_URL: string | undefined;
declare const NOTE_VIEW_VITE_DEV_SERVER_URL: string | undefined;
declare const EBOOK_VIEW_VITE_DEV_SERVER_URL: string | undefined;
declare const WEB_VIEW_VITE_DEV_SERVER_URL: string | undefined;
