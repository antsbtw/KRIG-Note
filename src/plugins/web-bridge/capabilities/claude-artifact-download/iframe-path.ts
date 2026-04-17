/**
 * iframe-path.ts
 *
 * Download an iframe-form (inline-rendered) Claude artifact via the
 * "..." menu. Two output formats are supported:
 *
 *   - svg: menu row 2 "Download file" → raw SVG bytes (via will-download)
 *   - png: menu row 1 "Copy to clipboard" → PNG dataUrl (via clipboard read)
 *
 * The "..." menu is rendered inside a cross-origin iframe and can't be
 * located via DOM queries from the parent page. We click by pixel
 * coordinate using CDP mouse synthesis (Input.dispatchMouseEvent) because
 * Radix UI ignores JS-dispatched events — only native pointer events
 * open the menu.
 *
 * SVG post-processing (encoding fix + CSS fallback injection) lives in
 * svg-postprocess.ts and is applied here before returning.
 */

import {
  CARD_ROOT_SELECTOR,
  CDP_TIMINGS,
  IFRAME_SELECTOR,
  MENU_OFFSETS,
} from './claude-ui-constants';
import {
  captureOneDownload,
  type ViewAPIDownloadCapture,
} from './download-slot';
import { postProcessClaudeSvg } from './svg-postprocess';
import {
  ClaudeArtifactDownloadError,
  type ClaudeArtifactDownload,
  type ClaudeArtifactRef,
} from './types';

// ─────────────────────────────────────────────────────────────
// View API shape for CDP mouse + clipboard image
// ─────────────────────────────────────────────────────────────

export interface ViewAPIIframePath extends ViewAPIDownloadCapture {
  wbSendMouse: (events: Array<{
    type: string; x: number; y: number;
    button?: string; buttons?: number; clickCount?: number;
  }>) => Promise<{ success: boolean; error?: string; count?: number }>;
  wbSendKey: (events: Array<{
    type: string;
    key: string;
    code?: string;
    windowsVirtualKeyCode?: number;
  }>) => Promise<{ success: boolean; error?: string; count?: number }>;
  wbReadClipboardImage: () => Promise<{
    success: boolean; empty?: boolean; dataUrl?: string; width?: number; height?: number;
  }>;
}

// ─────────────────────────────────────────────────────────────
// Resolve + scroll (guest side)
// ─────────────────────────────────────────────────────────────

interface IframeAnchor {
  /** Hotspot of the "..." button in page coords. */
  trX: number;
  trY: number;
  /** Center of the artifact card, for the middle point of hover trajectory. */
  cx: number;
  cy: number;
  /** Card rect, for viewport / size checks. */
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * Locate the ordinal-th standalone iframe artifact, scroll its card into
 * view, wait for height to stabilize, and return hover anchor points.
 */
async function resolveIframeAndScroll(
  webview: Electron.WebviewTag,
  ordinal: number,
): Promise<IframeAnchor> {
  const script = `
    (async function() {
      var cardSel = ${JSON.stringify(CARD_ROOT_SELECTOR)};
      var iframeSel = ${JSON.stringify(IFRAME_SELECTOR)};
      var cards = Array.from(document.querySelectorAll(cardSel)).filter(function(el) {
        var p = el.parentElement;
        while (p) {
          var cls = '';
          try { cls = (p.className && String(p.className)) || ''; } catch (e) {}
          if (cls.indexOf('group/artifact-block') >= 0) return false;
          p = p.parentElement;
        }
        var btns = Array.from(el.querySelectorAll('button, [role="button"], a'));
        for (var bi = 0; bi < btns.length; bi++) {
          var b = btns[bi];
          var label = ((b.innerText || b.textContent || '') + ' ' +
            (b.getAttribute('aria-label') || '') + ' ' +
            (b.getAttribute('title') || '')).toLowerCase();
          if (label.indexOf('download') >= 0) return true;
        }
        return false;
      });
      var allIframes = Array.from(document.querySelectorAll(iframeSel));

      // Merge in document order to match ordinal.
      var merged = cards.map(function(el) { return { form: 'card', el: el }; })
        .concat(allIframes.map(function(el) { return { form: 'iframe', el: el }; }));
      merged.sort(function(a, b) {
        var rel = a.el.compareDocumentPosition(b.el);
        if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      var entry = merged[${ordinal}];
      if (!entry) return { err: 'no-such-artifact', totalFound: merged.length };
      if (entry.form !== 'iframe') return { err: 'wrong-form', actual: entry.form };

      var iframe = entry.el;
      // Claude's iframe is wrapped in a card-like div ~3 ancestors up.
      var card = iframe;
      for (var k = 0; k < 3 && card.parentElement; k++) card = card.parentElement;
      card.scrollIntoView({ block: 'center', behavior: 'instant' });

      // Wait for iframe height to stabilize (lazy-load mount).
      var stableStart = Date.now();
      var lastH = -1;
      var lastChangeAt = Date.now();
      var deadline = Date.now() + ${CDP_TIMINGS.iframeStabilizeTimeoutMs};
      while (Date.now() < deadline) {
        var h = iframe.getBoundingClientRect().height;
        if (h >= ${CDP_TIMINGS.iframeMinHeight}) {
          if (h !== lastH) { lastH = h; lastChangeAt = Date.now(); }
          if (Date.now() - lastChangeAt >= ${CDP_TIMINGS.iframeStableMs}) break;
        }
        await new Promise(function(r) { setTimeout(r, 50); });
      }

      var r = card.getBoundingClientRect();
      if (r.height < ${CDP_TIMINGS.iframeMinHeight}) {
        return { err: 'iframe-not-in-viewport', height: r.height };
      }
      return {
        trX: Math.round(r.x + r.width - 30),
        trY: Math.round(r.y + 30),
        cx: Math.round(r.x + r.width / 2),
        cy: Math.round(r.y + r.height / 2),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    })()
  `;
  const r = await webview.executeJavaScript(script);
  if (!r) {
    throw new ClaudeArtifactDownloadError('no-such-artifact', { ordinal });
  }
  if (r.err === 'no-such-artifact') {
    throw new ClaudeArtifactDownloadError('no-such-artifact', { ordinal, totalFound: r.totalFound });
  }
  if (r.err === 'wrong-form') {
    throw new ClaudeArtifactDownloadError('wrong-form', { expected: 'iframe', actual: r.actual });
  }
  if (r.err === 'iframe-not-in-viewport') {
    throw new ClaudeArtifactDownloadError('iframe-not-in-viewport', { height: r.height });
  }
  return r as IframeAnchor;
}

// ─────────────────────────────────────────────────────────────
// CDP menu click
// ─────────────────────────────────────────────────────────────

type MenuItemKey = keyof typeof MENU_OFFSETS;

/**
 * Hover artifact card, open "..." menu, click one of its items. Does not
 * reset the mouse — caller should do that after it's read clipboard /
 * download, so the mouse doesn't move away mid-operation.
 */
async function cdpHoverAndClickMenuItem(
  view: ViewAPIIframePath,
  anchor: IframeAnchor,
  item: MenuItemKey,
): Promise<void> {
  // Three-segment hover: off-screen → center → top-right hotspot.
  // Radix UI won't open the menu on a single mouseMoved.
  const moveOk = await view.wbSendMouse([
    { type: 'mouseMoved', x: anchor.cx - 400, y: anchor.cy, button: 'none', buttons: 0 },
    { type: 'mouseMoved', x: anchor.cx, y: anchor.cy, button: 'none', buttons: 0 },
    { type: 'mouseMoved', x: anchor.trX, y: anchor.trY, button: 'none', buttons: 0 },
  ]);
  if (!moveOk.success) {
    throw new ClaudeArtifactDownloadError('cdp-menu-failed', { reason: 'wbSendMouse failed: ' + moveOk.error });
  }
  await sleep(CDP_TIMINGS.hoverToMenuOpenMs);

  const off = MENU_OFFSETS[item];
  const itemX = anchor.trX + off.dx;
  const itemY = anchor.trY + off.dy;

  // Move to item first (keeps menu open + triggers item highlight), then click.
  await view.wbSendMouse([{ type: 'mouseMoved', x: itemX, y: itemY, button: 'none', buttons: 0 }]);
  await sleep(CDP_TIMINGS.menuItemHoverToClickMs);
  await view.wbSendMouse([
    { type: 'mousePressed', x: itemX, y: itemY, button: 'left', buttons: 1, clickCount: 1 },
    { type: 'mouseReleased', x: itemX, y: itemY, button: 'left', buttons: 0, clickCount: 1 },
  ]);
}

async function resetMouse(view: ViewAPIIframePath): Promise<void> {
  try {
    await view.wbSendMouse([{ type: 'mouseMoved', x: 5, y: 5, button: 'none', buttons: 0 }]);
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// Public entry
// ─────────────────────────────────────────────────────────────

/**
 * Download an iframe-form Claude artifact.
 *
 * Only `ordinal` is supported from the renderer (DOM node refs can't
 * cross the executeJavaScript boundary).
 *
 * @param opts.format 'svg' (via Download file) or 'png' (via Copy to clipboard)
 * @param opts.timeout Max wait for the download / clipboard (default 10s)
 */
export async function downloadClaudeIframeArtifact(
  webview: Electron.WebviewTag,
  view: ViewAPIIframePath,
  ref: ClaudeArtifactRef,
  opts: { format: 'svg' | 'png'; timeout?: number },
): Promise<ClaudeArtifactDownload> {
  if (ref.cardEl !== undefined || ref.iframeEl !== undefined) {
    throw new ClaudeArtifactDownloadError('no-such-artifact', {
      reason: 'cardEl/iframeEl refs cannot cross executeJavaScript boundary; use ordinal',
    });
  }
  if (typeof ref.ordinal !== 'number') {
    throw new ClaudeArtifactDownloadError('no-such-artifact', { reason: 'ordinal required' });
  }

  const timeout = opts.timeout ?? 10_000;
  const startedAt = Date.now();

  const anchor = await resolveIframeAndScroll(webview, ref.ordinal);

  if (opts.format === 'svg') {
    return await downloadAsSvg(webview, view, anchor, timeout, startedAt);
  } else {
    return await downloadAsPng(view, anchor, timeout, startedAt);
  }
}

async function downloadAsSvg(
  webview: Electron.WebviewTag,
  view: ViewAPIIframePath,
  anchor: IframeAnchor,
  timeout: number,
  startedAt: number,
): Promise<ClaudeArtifactDownload> {
  // Arm download capture before clicking, so we don't race with will-download.
  const capturePromise = captureOneDownload(view, timeout);
  try {
    await cdpHoverAndClickMenuItem(view, anchor, 'downloadFile');
    await confirmDownloadPrompt(webview, view);
  } catch (err) {
    await capturePromise.catch(() => undefined);
    await resetMouse(view);
    throw err;
  }

  let dl;
  try {
    dl = await capturePromise;
  } finally {
    await resetMouse(view);
  }

  // SVG post-processing: encoding fix + CSS var fallback.
  const processed = postProcessClaudeSvg(dl.bytes);
  const normalizedMime = processed.naturalSize ? 'image/svg+xml' : (dl.mimeType || 'image/svg+xml');

  return {
    bytes: processed.bytes,
    mime: normalizedMime,
    filename: dl.filename,
    kind: { form: 'iframe', exportAs: 'svg' },
    title: stripExtension(dl.filename),
    meta: {
      pathTaken: 'iframe-cdp-menu-svg',
      encodingFixed: processed.encodingFixed,
      cssFallbackInjected: processed.cssFallbackInjected,
      naturalSize: processed.naturalSize,
      elapsedMs: Date.now() - startedAt,
    },
  };
}

async function confirmDownloadPrompt(
  webview: Electron.WebviewTag,
  view: ViewAPIIframePath,
): Promise<void> {
  await sleep(300);
  try {
    const viewport = await webview.executeJavaScript(`
      (function() {
        return {
          w: window.innerWidth || 0,
          h: window.innerHeight || 0
        };
      })()
    `).catch(() => null) as { w?: number; h?: number } | null;

    const w = Math.max(0, viewport?.w ?? 0);
    const h = Math.max(0, viewport?.h ?? 0);
    if (w <= 0 || h <= 0) return;

    // Chromium's in-webContents download prompt is centered in the guest
    // viewport. The primary "Download" button sits on the bottom-right of
    // that prompt. Click a few nearby points to absorb minor layout drift.
    const points = [
      { x: Math.round(w / 2 + 105), y: Math.round(h / 2 + 86) },
      { x: Math.round(w / 2 + 88), y: Math.round(h / 2 + 86) },
      { x: Math.round(w / 2 + 118), y: Math.round(h / 2 + 86) },
    ];

    for (const p of points) {
      await view.wbSendMouse([
        { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 },
        { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 },
        { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 },
      ]);
      await sleep(120);
    }
  } catch {}
}

async function downloadAsPng(
  view: ViewAPIIframePath,
  anchor: IframeAnchor,
  _timeout: number,
  startedAt: number,
): Promise<ClaudeArtifactDownload> {
  try {
    await cdpHoverAndClickMenuItem(view, anchor, 'copyToClipboard');
  } catch (err) {
    await resetMouse(view);
    throw err;
  }

  await sleep(CDP_TIMINGS.clipboardReadDelayMs);
  const img = await view.wbReadClipboardImage();
  await resetMouse(view);

  if (!img.success || !img.dataUrl) {
    throw new ClaudeArtifactDownloadError('download-empty', { reason: 'clipboard image empty or read failed' });
  }

  const bytes = dataUrlToBytes(img.dataUrl);
  const ts = Date.now();
  return {
    bytes,
    mime: 'image/png',
    filename: `artifact-${ts}.png`,
    kind: { form: 'iframe', exportAs: 'png' },
    title: '',
    meta: {
      pathTaken: 'iframe-cdp-menu-png',
      naturalSize: img.width && img.height ? { w: img.width, h: img.height } : undefined,
      elapsedMs: Date.now() - startedAt,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Local helpers
// ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stripExtension(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i > 0 ? filename.slice(0, i) : filename;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return new Uint8Array();
  const b64 = dataUrl.slice(comma + 1);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
