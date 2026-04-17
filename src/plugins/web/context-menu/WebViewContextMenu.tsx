/**
 * WebViewContextMenu — host-side menu surface shared by every webview
 * variant. Listens for `krig:context-menu` ipc-messages from the guest
 * preload, renders a floating menu at the reported coordinates, and
 * invokes the matching item's onClick. Variants pass their own items
 * in; built-ins are appended automatically.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { ContextMenuItem, ContextMenuItems, GuestContextSignal, MenuContext, WebViewContextMenuProps } from './types';
import { BUILTIN_ITEMS } from './built-in-items';

declare const viewAPI: {
  onWebviewContextMenu: (cb: (payload: any) => void) => () => void;
};

export function WebViewContextMenu({ webviewRef, items = [] }: WebViewContextMenuProps) {
  const [signal, setSignal] = useState<GuestContextSignal | null>(null);
  const [busy, setBusy] = useState(false);

  // Merge variant items + built-ins. Variants come first so the most
  // relevant action (e.g. 提取到笔记) is at the top.
  const merged = useMemo<ContextMenuItems>(
    () => [...items, ...BUILTIN_ITEMS],
    [items],
  );

  useEffect(() => {
    // Subscribe to right-click events forwarded by main from EVERY guest
    // webContents. Chromium fires `context-menu` at the browser layer,
    // so this path covers cross-origin iframes (artifact panels, DALL·E
    // image containers) — exactly like Chrome's built-in menu does.
    // Filter by webContents id so each variant's menu only opens for
    // its own <webview>.
    const unsub = viewAPI.onWebviewContextMenu((payload) => {
      const el = webviewRef.current;
      if (!el) return;
      const myId = (el as any).getWebContentsId?.();
      if (typeof payload?.guestId === 'number' && payload.guestId !== myId) return;
      if (typeof payload?.x !== 'number') return;
      setSignal({
        x: payload.x | 0,
        y: payload.y | 0,
        targetTag: null,
        targetHtml: '',
      });
    });
    return unsub;
  }, [webviewRef]);

  if (!signal) return null;

  const webview = webviewRef.current;
  if (!webview) return null;

  const ctx: MenuContext = {
    ...signal,
    webview,
    url: webview.getURL?.() || '',
  };

  const dismiss = () => setSignal(null);

  const handleClick = async (item: ContextMenuItem) => {
    if (busy) return;
    const enabled = item.enabled ? item.enabled(ctx) : true;
    if (!enabled) return;
    console.log('[WebViewContextMenu] click', {
      itemId: item.id,
      x: ctx.x,
      y: ctx.y,
      url: ctx.url,
    });
    setBusy(true);
    try {
      await item.onClick(ctx);
    } finally {
      setBusy(false);
      setSignal(null);
    }
  };

  return (
    <>
      {/* Click-outside dismiss overlay — covers the webview surface. */}
      <div
        style={overlayStyle}
        onClick={dismiss}
        onContextMenu={(e) => { e.preventDefault(); dismiss(); }}
      />
      <div
        style={{
          ...menuStyle,
          left: Math.max(4, Math.min(signal.x, (webview.clientWidth || 1200) - 200)),
          top: Math.max(4, Math.min(signal.y, (webview.clientHeight || 800) - 20)),
        }}
      >
        {merged.map((item, i) => {
          const visible = item.visible ? item.visible(ctx) : true;
          if (!visible) return null;
          const enabled = item.enabled ? item.enabled(ctx) : true;
          const label = typeof item.label === 'function' ? item.label(ctx) : item.label;
          return (
            <div key={item.id}>
              {item.dividerAbove && i > 0 && <div style={dividerStyle} />}
              <button
                disabled={!enabled || busy}
                style={itemStyle(!enabled || busy)}
                onClick={() => handleClick(item)}
                onMouseEnter={(e) => { if (enabled && !busy) (e.currentTarget as HTMLButtonElement).style.background = '#3a3a3a'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                {item.icon && <span>{item.icon}</span>}
                <span>{label}</span>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 999,
};

const menuStyle: CSSProperties = {
  position: 'absolute',
  background: '#2a2a2a',
  border: '1px solid #444',
  borderRadius: 8,
  padding: 4,
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  minWidth: 160,
  zIndex: 1000,
};

const dividerStyle: CSSProperties = {
  height: 1,
  background: '#444',
  margin: '4px 0',
};

function itemStyle(disabled: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 12px',
    background: 'transparent',
    border: 'none',
    color: disabled ? '#666' : '#e8eaed',
    fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: 4,
    textAlign: 'left',
  };
}
