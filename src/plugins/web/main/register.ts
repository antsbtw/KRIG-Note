import { workModeRegistry } from '../../../main/workmode/registry';
import { navSideRegistry } from '../../../main/navside/registry';
import { protocolRegistry } from '../../../main/protocol/registry';
import { menuRegistry } from '../../../main/menu/registry';
import { setupExtractionInterceptor } from './extraction-handler';
import { setupCSPBypass } from '../../web-bridge/infrastructure/csp-bypass';
import { registerGuest } from '../../web-bridge/infrastructure/guest-registry';
import { registerWebIpcHandlers } from './ipc-handlers';
import type { PluginContext } from '../../../shared/plugin-types';

/**
 * Web Plugin — 框架注册
 *
 * 注册 WebView 的 WorkMode（含 extraction/translate/ai 变体）、NavSide、Protocol、Menu、IPC Handlers。
 */

export function register(ctx: PluginContext): void {
  // ── IPC Handlers ──
  registerWebIpcHandlers(ctx.getMainWindow);
  // ── WorkMode: 基础 Web ──
  workModeRegistry.register({
    id: 'demo-c',
    viewType: 'web',
    icon: '🌐',
    label: 'Web',
    order: 3,
  });

  // ── WorkMode: Extraction 变体 ──
  workModeRegistry.register({
    id: 'extraction',
    viewType: 'web',
    variant: 'extraction',
    icon: '📤',
    label: 'Extraction',
    order: 4,
    hidden: true,
    onViewCreated: (_view, guestWebContents) => {
      setupExtractionInterceptor(guestWebContents);
    },
  });

  // ── WorkMode: Translate 变体 ──
  workModeRegistry.register({
    id: 'web-translate',
    viewType: 'web',
    variant: 'translate',
    icon: '🌐',
    label: 'Translate',
    order: 5,
    hidden: true,
    onViewCreated: (_view, guestWebContents) => {
      setupCSPBypass(guestWebContents);
    },
  });

  // ── WorkMode: AI 变体（Right Slot） ──
  workModeRegistry.register({
    id: 'ai-web',
    viewType: 'web',
    variant: 'ai',
    icon: '🤖',
    label: 'AI',
    order: 6,
    hidden: true,
    onViewCreated: (view, guestWebContents) => {
      setupCSPBypass(guestWebContents);
      registerGuest(view.webContents, guestWebContents);
    },
  });

  // ── WorkMode: AI Sync 模式（Left Slot，显示在 NavSide） ──
  workModeRegistry.register({
    id: 'ai-sync',
    viewType: 'web',
    variant: 'ai',
    icon: '🤖',
    label: 'AI',
    order: 4,
    hidden: false,
    onViewCreated: (view, guestWebContents) => {
      setupCSPBypass(guestWebContents);
      registerGuest(view.webContents, guestWebContents);
    },
  });

  // ── NavSide ──
  navSideRegistry.register({
    workModeId: 'demo-c',
    actionBar: { title: '网页', actions: [
      { id: 'create-web-folder', label: '+ 文件夹' },
      { id: 'add-web-bookmark', label: '+ 书签' },
    ]},
    contentType: 'web-bookmarks',
  });

  navSideRegistry.register({
    workModeId: 'ai-sync',
    actionBar: { title: 'AI 对话', actions: [] },
    contentType: 'ai-services',
  });

  // ── Protocol ──
  protocolRegistry.register({ id: 'web-note',      match: { left: { type: 'web' },  right: { type: 'note' } } });
  protocolRegistry.register({ id: 'web-web',        match: { left: { type: 'web' },  right: { type: 'web' } } });
  protocolRegistry.register({ id: 'web-translate',  match: { left: { type: 'web' },  right: { type: 'web', variant: 'translate' } } });
  protocolRegistry.register({ id: 'ai-sync',        match: { left: { type: 'web', variant: 'ai' }, right: { type: 'note' } } });

  // ── Menu ──
  menuRegistry.register({
    id: 'web-menu',
    label: 'Web',
    order: 12,
    items: [
      { id: 'go-back', label: 'Back', accelerator: 'CmdOrCtrl+[', handler: () => console.log('Go Back') },
      { id: 'go-forward', label: 'Forward', accelerator: 'CmdOrCtrl+]', handler: () => console.log('Go Forward') },
      { id: 'sep1', label: '', separator: true, handler: () => {} },
      { id: 'extract', label: 'Extract Page', handler: () => console.log('Extract') },
    ],
  });
}
