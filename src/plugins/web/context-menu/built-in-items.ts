/**
 * Built-in context menu items shared by every webview variant.
 *
 * Kept minimal — just the browser-baseline actions that every page
 * expects (reload, inspect). Variants are free to skip these by
 * passing their own complete list rather than appending.
 */

import type { ContextMenuItem } from './types';

export const BUILTIN_ITEMS: readonly ContextMenuItem[] = [
  {
    id: 'reload',
    icon: '↻',
    label: '刷新页面',
    dividerAbove: true,
    onClick: ({ webview }) => {
      webview.reload();
    },
  },
  {
    id: 'inspect',
    icon: '🛠',
    label: '检查元素',
    onClick: ({ webview }) => {
      (webview as any).openDevTools?.();
    },
  },
];
