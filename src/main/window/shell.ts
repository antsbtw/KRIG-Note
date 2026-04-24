import { BaseWindow, WebContentsView } from 'electron';
import path from 'node:path';
import { calculateLayout } from '../slot/layout';
import { workspaceManager } from '../workspace/manager';
import { workModeRegistry } from '../workmode/registry';
import { protocolRegistry } from '../protocol/registry';
import { DIVIDER_HTML } from '../slot/divider';
import { IPC } from '../../shared/types';
import type { WorkspaceId, ViewType, ViewTypeRendererConfig } from '../../shared/types';
import { bindWebContentsPage, setWebContentsVisibility } from '../../plugins/browser-capability';

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
let overlayView: WebContentsView | null = null;

// ── Workspace 隔离的 View 实例池 ──

interface WorkspaceViewPool {
  leftViews: Map<string, WebContentsView>;    // workModeId → Left View
  rightViews: Map<string, WebContentsView>;   // workModeId → Right View（缓存池）
  rightWorkModeId: string | null;             // 当前显示的 Right View workModeId
  activeLeftId: string | null;                // 当前 Left Slot 显示的 workModeId
}

const workspaceViewPools: Map<WorkspaceId, WorkspaceViewPool> = new Map();

function getViewPool(workspaceId: WorkspaceId): WorkspaceViewPool {
  let pool = workspaceViewPools.get(workspaceId);
  if (!pool) {
    pool = { leftViews: new Map(), rightViews: new Map(), rightWorkModeId: null, activeLeftId: null };
    workspaceViewPools.set(workspaceId, pool);
  }
  return pool;
}

/** ViewType → 渲染器配置映射 */
const viewTypeRenderers: Record<ViewType | 'default', ViewTypeRendererConfig> = {
  note:  { devServerUrl: NOTE_VIEW_VITE_DEV_SERVER_URL,  htmlFile: 'note.html',      prodDir: 'note_view' },
  ebook: { devServerUrl: EBOOK_VIEW_VITE_DEV_SERVER_URL, htmlFile: 'ebook.html',     prodDir: 'ebook_view' },
  web:   { devServerUrl: WEB_VIEW_VITE_DEV_SERVER_URL,   htmlFile: 'web.html',       prodDir: 'web_view',   webPreferences: { webviewTag: true } },
  thought: { devServerUrl: THOUGHT_VIEW_VITE_DEV_SERVER_URL, htmlFile: 'thought.html', prodDir: 'thought_view' },
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
  bindWebContentsPage(view.webContents, {
    owner: 'system',
    visibility: 'hidden',
    partition: config.webPreferences?.webviewTag ? 'persist:webview-host' : 'persist:view',
  });

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
    view.webContents.on('will-attach-webview', (_event, webPreferences) => {
      // Inject the guest preload (context-menu signal + CSP bypass).
      // This is the only reliable way to keep our listener alive across
      // SPA navigations that replace the document object.
      webPreferences.preload = path.join(__dirname, 'web-content.js');
      webPreferences.contextIsolation = true;
      webPreferences.nodeIntegration = false;
    });
    view.webContents.on('did-attach-webview', (_event, guestWebContents) => {
      bindWebContentsPage(guestWebContents, {
        owner: 'user',
        visibility: 'foreground',
        partition: 'persist:web',
      });
      guestWebContents.on('did-start-loading', () => {
      });
      guestWebContents.on('did-stop-loading', () => {
      });
      guestWebContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      });
      guestWebContents.on('render-process-gone', (_e, details) => {
      });
      guestWebContents.on('unresponsive', () => {
      });
      guestWebContents.on('responsive', () => {
      });

      // 弹窗策略：target=_blank → 内部导航，OAuth → 允许子窗口
      guestWebContents.setWindowOpenHandler(({ url, disposition }) => {
        if (!url || url === 'about:blank') return { action: 'allow' };
        if (disposition === 'foreground-tab' || disposition === 'background-tab') {
          // 延迟 loadURL — 在 setWindowOpenHandler 回调中同步调用会导致死锁
          setTimeout(() => {
            guestWebContents.loadURL(url).catch(() => {});
          }, 0);
          return { action: 'deny' };
        }
        return { action: 'allow' };
      });

      // Chromium-layer right-click. This fires for ANY click — including
      // those inside cross-origin iframes (artifact panels, DALL·E
      // containers) — because it comes from the browser layer, above
      // the page-JS sandbox. Forward to the embedder renderer so
      // WebViewContextMenu can render its overlay.
      guestWebContents.on('context-menu', (_e, params) => {
        view.webContents.send('krig:webview-context-menu', {
          guestId: guestWebContents.id,
          x: params.x,
          y: params.y,
          linkURL: params.linkURL,
          srcURL: params.srcURL,
          mediaType: params.mediaType,
          selectionText: params.selectionText,
          isEditable: params.isEditable,
          frameURL: params.frameURL,
        });
      });

      // 调用插件注册的 onViewCreated hook
      mode?.onViewCreated?.(view, guestWebContents);
    });
  }

  mainWindow?.contentView.addChildView(view);
  view.setVisible(false);
  setWebContentsVisibility(view.webContents, 'hidden');
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
    if (oldView) {
      oldView.setVisible(false);
      setWebContentsVisibility(oldView.webContents, 'hidden');
    }
  }

  // 显示/创建新 Left View
  let newView = pool.leftViews.get(workModeId);
  if (!newView) {
    newView = createViewForWorkMode(workModeId);
    pool.leftViews.set(workModeId, newView);
  }
  newView.setVisible(true);
  setWebContentsVisibility(newView.webContents, 'foreground');
  pool.activeLeftId = workModeId;

  // 同步 slotBinding.left 到 WorkspaceState
  workspaceManager.update(active.id, {
    slotBinding: { ...active.slotBinding, left: workModeId },
  });

  updateLayout();
}

/** 获取当前显示中的 Right View（如果有） */
function getActiveRightView(pool: WorkspaceViewPool): WebContentsView | null {
  if (!pool.rightWorkModeId) return null;
  return pool.rightViews.get(pool.rightWorkModeId) ?? null;
}

/** 打开 Right Slot — 缓存池模式，切换时隐藏而非销毁 */
export function openRightSlot(workModeId: string): WebContentsView | null {
  if (!mainWindow) return null;
  const active = workspaceManager.getActive();
  if (!active) return null;

  const pool = getViewPool(active.id);
  const currentRight = getActiveRightView(pool);

  // 如果当前显示的就是目标 workModeId，关闭它（toggle 行为）
  if (currentRight && pool.rightWorkModeId === workModeId) {
    closeRightSlot();
    return null;
  }

  // 隐藏当前的 Right View（不销毁，保留在缓存池中）
  if (currentRight) {
    currentRight.setVisible(false);
    mainWindow.contentView.removeChildView(currentRight);
    setWebContentsVisibility(currentRight.webContents, 'hidden');
  }

  // 从缓存池取已有的 View，或创建新的
  let targetView = pool.rightViews.get(workModeId);
  if (!targetView || targetView.webContents.isDestroyed()) {
    targetView = createViewForWorkMode(workModeId);
    pool.rightViews.set(workModeId, targetView);

    // 诊断：监听 renderer 崩溃
    targetView.webContents.on('render-process-gone', (_e, details) => {
      console.error('[RightSlot] Renderer process gone:', details.reason, details.exitCode);
    });
  }

  pool.rightWorkModeId = workModeId;
  targetView.setVisible(true);
  setWebContentsVisibility(targetView.webContents, 'background');
  mainWindow.contentView.addChildView(targetView);

  // 同步 slotBinding.right 到 WorkspaceState
  workspaceManager.update(active.id, {
    slotBinding: { ...active.slotBinding, right: workModeId },
  });

  // 显示 Divider
  ensureDivider();
  dividerView?.setVisible(true);

  updateLayout();
  return targetView;
}

/** 关闭 Right Slot */
export function closeRightSlot(): void {
  if (!mainWindow) return;
  const active = workspaceManager.getActive();
  if (!active) return;

  const pool = getViewPool(active.id);

  const currentRight = getActiveRightView(pool);
  if (currentRight) {
    currentRight.setVisible(false);
    mainWindow.contentView.removeChildView(currentRight);
    setWebContentsVisibility(currentRight.webContents, 'hidden');
    // 不销毁 — 保留在缓存池中
  }
  pool.rightWorkModeId = null;

  // 同步 slotBinding.right 到 WorkspaceState，并清空 right slot 的活跃资源 id
  workspaceManager.update(active.id, {
    slotBinding: { ...active.slotBinding, right: null },
    rightActiveNoteId: null,
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
      for (const view of oldPool.leftViews.values()) setWebContentsVisibility(view.webContents, 'hidden');
      const oldRight = getActiveRightView(oldPool);
      if (oldRight) {
        oldRight.setVisible(false);
        setWebContentsVisibility(oldRight.webContents, 'hidden');
      }
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
      if (leftView) {
        leftView.setVisible(true);
        setWebContentsVisibility(leftView.webContents, 'foreground');
      }
    } else {
      switchLeftSlotView(newWorkspace.workModeId);
    }

    // 恢复 Right Slot
    const restoredRight = getActiveRightView(pool);
    if (restoredRight) {
      restoredRight.setVisible(true);
      setWebContentsVisibility(restoredRight.webContents, 'background');
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
    setWebContentsVisibility(view.webContents, 'hidden');
    view.webContents.close();
  }

  for (const rv of pool.rightViews.values()) {
    if (mainWindow.contentView.children.includes(rv)) {
      mainWindow.contentView.removeChildView(rv);
    }
    setWebContentsVisibility(rv.webContents, 'hidden');
    rv.webContents.close();
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
  const activeRight = getActiveRightView(pool);
  if (activeRight?.webContents.id === senderId) return 'right';
  // Also check all cached right views
  for (const rv of pool.rightViews.values()) {
    if (rv.webContents.id === senderId) return 'right';
  }
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
  const currentRight = getActiveRightView(pool);
  if (!currentRight || !pool.rightWorkModeId) return;

  // 销毁 left view
  if (pool.activeLeftId) {
    const leftView = pool.leftViews.get(pool.activeLeftId);
    if (leftView) {
      leftView.setVisible(false);
      setWebContentsVisibility(leftView.webContents, 'hidden');
      mainWindow.contentView.removeChildView(leftView);
      leftView.webContents.close();
    }
    pool.leftViews.delete(pool.activeLeftId);
  }
  // right 晋升为 left
  const promotedView = currentRight;
  const promotedModeId = pool.rightWorkModeId;
  pool.rightViews.delete(promotedModeId);
  pool.leftViews.set(promotedModeId, promotedView);
  pool.activeLeftId = promotedModeId;
  pool.rightWorkModeId = null;
  setWebContentsVisibility(promotedView.webContents, 'foreground');

  // 同步活跃资源 id：让 NavSide 等"活跃资源消费者"不再高亮已销毁 left view 的资源。
  // 规则：
  //   - 晋升的是 NoteView：activeNoteId ← rightActiveNoteId，rightActiveNoteId → null
  //   - 晋升的是其他类型 view：activeNoteId → null（当前工作空间没有活跃 note 了）
  // 架构债（见 CLAUDE memory）：eBook 只有 activeBookId 没 rightActiveBookId，
  //   生命周期对称性不完整；Note 的"left/right 两字段"做法本身也是局部补丁。
  //   后续应在 workspace 层抽象 "per-slot per-viewType 的活跃资源 id" 统一管理。
  const promotedViewType = workModeRegistry.get(promotedModeId)?.viewType;
  const resourceUpdates: Record<string, unknown> = {
    workModeId: promotedModeId,
    // 同步 slotBinding：左槽现在装的是晋升上来的 view，右槽清空。
    // 如果不更新，session 保存时仍是关闭前的双屏布局，下次启动又恢复为双屏。
    slotBinding: { left: promotedModeId, right: null },
  };
  if (promotedViewType === 'note') {
    resourceUpdates.activeNoteId = active.rightActiveNoteId ?? null;
    resourceUpdates.rightActiveNoteId = null;
  } else {
    resourceUpdates.activeNoteId = null;
    resourceUpdates.rightActiveNoteId = null;
  }
  workspaceManager.update(active.id, resourceUpdates);

  dividerView?.setVisible(false);
  updateLayout();
}

/** 获取当前 Workspace 是否有 Right Slot */
export function hasRightSlot(): boolean {
  const active = workspaceManager.getActive();
  if (!active) return false;
  const pool = workspaceViewPools.get(active.id);
  return pool?.rightWorkModeId !== null && pool?.rightWorkModeId !== undefined;
}

/** 检查当前 Right Slot 是否是指定 workModeId */
export function isRightSlotMode(workModeId: string): boolean {
  const active = workspaceManager.getActive();
  if (!active) return false;
  const pool = workspaceViewPools.get(active.id);
  return pool?.rightWorkModeId === workModeId;
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
    rightId: getActiveRightView(pool)?.webContents.id ?? null,
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

  // 全屏进度覆盖层（默认隐藏，备份/恢复/重置等长任务时显示）
  overlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'shell.js'),
      contextIsolation: true,
      nodeIntegration: false,
      transparent: true,
    },
  });
  overlayView.setBackgroundColor('#00000000');
  overlayView.setVisible(false);

  mainWindow.contentView.addChildView(toggleView);
  mainWindow.contentView.addChildView(shellView);
  mainWindow.contentView.addChildView(navSideView);
  mainWindow.contentView.addChildView(navResizeView);
  // overlayView 延迟加载：不 addChildView，只在 showOverlay() 时按需挂载

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
    overlayView = null;
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
    const activeRight = pool ? getActiveRightView(pool) : null;
    if (activeRight && layout.rightSlot && layout.divider) {
      activeRight.setBounds(layout.rightSlot);
      if (dividerView) dividerView.setBounds(layout.divider);
    }
  }

  // 进度覆盖层：占满整个窗口
  if (overlayView) {
    overlayView.setBounds({ x: 0, y: 0, width: windowWidth, height: windowHeight });
  }
}

/**
 * 显示/隐藏全屏进度覆盖层
 * 长耗时任务（backup/restore/reset）期间阻塞 UI
 * 首次调用时才加载 overlay HTML，避免干扰正常启动流程
 */
let overlayLoaded = false;
export async function showOverlay(): Promise<void> {
  if (!overlayView || !mainWindow) return;

  // 首次使用才加载 HTML
  if (!overlayLoaded) {
    if (OVERLAY_VITE_DEV_SERVER_URL) {
      await overlayView.webContents.loadURL(`${OVERLAY_VITE_DEV_SERVER_URL}/overlay.html`);
    } else {
      await overlayView.webContents.loadFile(path.join(__dirname, `../renderer/overlay/overlay.html`));
    }
    overlayLoaded = true;
  }

  overlayView.setVisible(true);
  // 确保在最上层
  mainWindow.contentView.addChildView(overlayView);
  updateLayout();
}

export function hideOverlay(): void {
  if (!overlayView || !mainWindow) return;
  overlayView.setVisible(false);
  // 从 child views 中移除，让下方 view 恢复接收事件
  try { mainWindow.contentView.removeChildView(overlayView); } catch {}
}

/** 向 overlayView 发送进度事件 */
export function sendToOverlay(channel: string, payload: unknown): void {
  overlayView?.webContents.send(channel, payload);
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
    justify-content: flex-start;
    padding-left: 6px;
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
declare const OVERLAY_VITE_DEV_SERVER_URL: string | undefined;
declare const NAVSIDE_VITE_DEV_SERVER_URL: string | undefined;
declare const DEMO_VIEW_VITE_DEV_SERVER_URL: string | undefined;
declare const NOTE_VIEW_VITE_DEV_SERVER_URL: string | undefined;
declare const EBOOK_VIEW_VITE_DEV_SERVER_URL: string | undefined;
declare const WEB_VIEW_VITE_DEV_SERVER_URL: string | undefined;
declare const THOUGHT_VIEW_VITE_DEV_SERVER_URL: string | undefined;
