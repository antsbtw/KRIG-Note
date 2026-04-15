/**
 * Claude Artifact Extractor — self-contained Claude-only module
 *
 * This is the single entry point for extracting Claude artifacts. Other
 * parts of the codebase should import from here and NOT re-implement
 * iframe discovery, CDP mouse synthesis, or clipboard reads for artifacts.
 *
 * Public surface (stable):
 *   - listArtifacts(webview)
 *   - extractArtifactImage(webview, view, index)
 *   - extractArtifactSource(webview, view, index)        // interface-ready
 *   - triggerArtifactSave(webview, view, index)          // interface-ready
 *   - extractAll(webview, view, opts)
 *   - debugExtractFirstArtifact(webview, view)           // manual test hook
 *   - fetchArtifactVersions(webview)                     // Layer 1 probe
 *
 * Other AI services (ChatGPT, Gemini) should live in their own sibling
 * modules (e.g. `chatgpt-artifact-extractor.ts`) and follow the same
 * shape. Do not mix services here.
 *
 * Three-layer strategy, discovered via reverse-engineering (see
 * docs/web/Claude-Artifact-Extraction-Problem.md):
 *
 *   Layer 1 — API (passive, zero user-impact)
 *     /api/organizations/{org}/artifacts/{conv}/versions
 *       Currently returns `{ artifact_versions: [] }` for all observed
 *       conversations. Kept here in case Anthropic populates it later.
 *     /api/organizations/{org}/chat_conversations/{conv}
 *       Returns conversation text with placeholders in artifact positions
 *       ("This block is not supported on your current device yet.").
 *
 *   Layer 2 — postMessage Hook (passive)
 *     Observes claude.ai ↔ iframe MCP traffic. Does NOT yield artifact
 *     source (parent never posts source to iframe — iframe fetches
 *     itself from claudemcpcontent.com, cross-origin). Useful for
 *     diagnostics only.
 *
 *   Layer 3 — CDP Mouse Simulation (active, user-visible)
 *     The artifact card shows a "..." menu on hover with three items:
 *       - "Copy to clipboard" → writes rendered PNG to system clipboard
 *       - "Download file"     → triggers browser download of .html source
 *       - "Save as artifact"  → saves to the user's Claude-side library
 *     Radix UI does not respond to JS-dispatched events, so we must use
 *     CDP `Input.dispatchMouseEvent` via webContents.debugger to synthesize
 *     native pointer events. This module exposes one function per menu item
 *     plus a batch extractor.
 *
 * Constraints verified during reverse-engineering:
 *   - Artifact card must be inside the viewport, otherwise hover doesn't
 *     activate (Claude's performance optimization — off-screen iframes
 *     don't react). We scrollIntoView before hovering.
 *   - Hover must follow a multi-point trajectory (outside → center →
 *     top-right) for Radix to register it as a real pointer. A single
 *     mouseMoved to the "..." hotspot doesn't open the menu.
 *   - Menu DOM is rendered inside the cross-origin iframe and NOT in the
 *     parent document, so `querySelectorAll` from Claude's page can't find
 *     menu items. We click by pixel coordinate (CDP bypasses the SOP for
 *     input synthesis).
 *   - After clicking the menu item, the clipboard contains a PNG image
 *     (not text), so we read via `clipboard.readImage()` rather than
 *     `readText()`.
 *
 * Module status (2026-04-13):
 *   - extractArtifactImage: production-ready (verified against multiple
 *     artifacts, including scrolled-off-screen cases).
 *   - extractArtifactSource: interface ready, main-process download hook
 *     implemented, wiring to UI deferred until module 5.
 *   - triggerArtifactSave: interface ready, KRIG does not consume the
 *     output (data stays in the user's Claude account). Exposed for
 *     future "one-click cloud backup" feature.
 *
 * Design doc: docs/web/WebBridge-设计.md §五, §Claude-Artifact-Extraction-Problem
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ArtifactDescriptor {
  /** 0-based index among all artifact iframes on the page. */
  index: number;
  /** Source URL of the iframe (claudemcpcontent.com / claudeusercontent.com). */
  iframeSrc: string;
  /** Bounding rect of the outer artifact card at discovery time. */
  cardRect: { x: number; y: number; width: number; height: number };
  /** True if the artifact is currently displayed fullscreen (has Close fullscreen button nearby). */
  isFullscreen: boolean;
}

export interface ArtifactImage {
  /** `data:image/png;base64,...` */
  dataUrl: string;
  width: number;
  height: number;
}

export interface ArtifactSource {
  /** Full HTML source, UTF-8 string. */
  content: string;
  /** Original download filename (e.g. `laplace_heat_conduction_sim.html`). */
  filename: string;
  /** Always `text/html` for current Claude artifacts. */
  mimeType: string;
}

export interface ExtractedArtifact extends ArtifactDescriptor {
  image?: ArtifactImage | null;
  source?: ArtifactSource | null;
  saved?: boolean;
}

export interface ExtractOptions {
  /** Extract rendered PNG via Copy to clipboard (default: true). */
  image?: boolean;
  /** Extract HTML source via Download file (default: false; requires main-process download hook). */
  source?: boolean;
  /** Trigger Save as artifact on Claude's side (default: false; KRIG does not read the result). */
  save?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Menu geometry
//
// The "..." menu is rendered inside the cross-origin artifact iframe, so
// we cannot locate menu items via DOM queries. These offsets are measured
// empirically from a verified-working session. They're relative to the
// "..." button hotspot (top-right corner of the card, ~30px inset).
//
// If Claude restyles the menu, adjust these three constants — everything
// else in this module will keep working.
// ─────────────────────────────────────────────────────────────

const MENU_OFFSETS = {
  /** Copy to clipboard (rendered PNG image). */
  copy: { dx: -80, dy: 45 },
  /** Download file (full HTML source). */
  download: { dx: -80, dy: 45 + 36 },
  /** Save as artifact (to user's Claude-side library). */
  save: { dx: -80, dy: 45 + 72 },
} as const;

type MenuItem = keyof typeof MENU_OFFSETS;

// Timing constants, all measured empirically. Tightening any of these
// makes the hover/click flow unreliable.
const SCROLL_SETTLE_MS = 400;
const HOVER_SETTLE_MS = 250;
const PRE_CLICK_HOLD_MS = 100;
const POST_CLICK_WAIT_MS = 700;

// CDP IPC surface. Renderer contract matches preload/view.ts.
interface ViewAPILike {
  wbSendMouse: (events: Array<{
    type: string; x: number; y: number;
    button?: string; buttons?: number; clickCount?: number;
  }>) => Promise<{ success: boolean; error?: string; count?: number }>;
  wbReadClipboardImage: () => Promise<{
    success: boolean; empty?: boolean; dataUrl?: string; width?: number; height?: number;
  }>;
}

// ─────────────────────────────────────────────────────────────
// Layer 1 — API (artifacts versions endpoint)
// ─────────────────────────────────────────────────────────────

/** Conversation-id regex matching Claude chat URLs. */
function extractConversationId(url: string): string | null {
  const m = url.match(/\/chat\/([a-f0-9-]{36})/);
  return m ? m[1] : null;
}

/**
 * Fetch `/api/organizations/{org}/artifacts/{conv}/versions`.
 *
 * Observed (2026-04): returns `{ artifact_versions: [] }` unconditionally,
 * even after streaming finishes. Kept here for forward compatibility — if
 * Anthropic starts populating this endpoint, the rest of the module is
 * already wired to consume it.
 */
export async function fetchArtifactVersions(
  webview: Electron.WebviewTag,
): Promise<any[] | null> {
  const url = webview.getURL?.() || '';
  const convId = extractConversationId(url);
  if (!convId) return null;

  try {
    const script = `(async function() {
      var orgsResp = await fetch('/api/organizations/', { credentials: 'include' });
      if (!orgsResp.ok) return null;
      var orgs = await orgsResp.json();
      if (!Array.isArray(orgs) || orgs.length === 0) return null;
      var orgId = orgs[0].uuid;
      var convId = ${JSON.stringify(convId)};
      var tries = [
        '/api/organizations/' + orgId + '/artifacts/' + convId + '/versions?source=w',
        '/api/organizations/' + orgId + '/artifacts/' + convId + '/versions',
      ];
      for (var i = 0; i < tries.length; i++) {
        try {
          var r = await fetch(tries[i], { credentials: 'include' });
          if (!r.ok) continue;
          var j = await r.json();
          var vers = j && (j.artifact_versions || j.versions);
          if (Array.isArray(vers)) return vers;
        } catch (e) {}
      }
      return null;
    })()`;
    const r = await webview.executeJavaScript(script);
    return Array.isArray(r) ? r : null;
  } catch {
    return null;
  }
}

/**
 * Heuristic: find the first plausible source-code string inside an
 * artifact_versions entry. Left here for when the API starts filling in.
 */
export function extractSourceFromVersion(version: any): string | null {
  if (!version || typeof version !== 'object') return null;
  const keys = ['content', 'source', 'code', 'html', 'body', 'markup'];
  for (const k of keys) {
    const v = (version as any)[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  if (version.artifact) return extractSourceFromVersion(version.artifact);
  if (version.data) return extractSourceFromVersion(version.data);
  return null;
}

// ─────────────────────────────────────────────────────────────
// Layer 3 — CDP mouse primitives
// ─────────────────────────────────────────────────────────────

/**
 * Enumerate all Claude artifact iframes visible on the current page.
 *
 * Walks each iframe's ancestors to find the artifact card container
 * (three levels up from the iframe, in Claude's current DOM).
 *
 * Note: the returned `cardRect` is a snapshot — it will be stale once
 * we scroll. Callers that need fresh coordinates should re-read via
 * `readArtifactRect(webview, index)` after scrollIntoView.
 */
export async function listArtifacts(
  webview: Electron.WebviewTag,
): Promise<ArtifactDescriptor[]> {
  const script = `
    (function() {
      var sel = 'iframe[src*="claudemcpcontent"], iframe[src*="claudeusercontent"]';
      var frames = Array.from(document.querySelectorAll(sel));
      return frames.map(function(iframe, i) {
        var card = iframe;
        for (var k = 0; k < 3 && card.parentElement; k++) card = card.parentElement;
        var r = card.getBoundingClientRect();
        // Fullscreen artifact has a "Close fullscreen" button nearby.
        var closeBtn = document.querySelector('button[aria-label="Close fullscreen"]');
        return {
          index: i,
          iframeSrc: iframe.src || '',
          cardRect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
          isFullscreen: !!closeBtn,
        };
      });
    })()
  `;
  const arr = await webview.executeJavaScript(script);
  return Array.isArray(arr) ? arr : [];
}

/**
 * Scroll the Nth artifact card into view and return its fresh rect +
 * hover-trajectory anchor points. Returns null if the card is not found.
 */
async function scrollAndReadRect(
  webview: Electron.WebviewTag,
  index: number,
): Promise<{ cx: number; cy: number; trX: number; trY: number; rect: { x: number; y: number; w: number; h: number } } | null> {
  const script = `
    (async function() {
      var sel = 'iframe[src*="claudemcpcontent"], iframe[src*="claudeusercontent"]';
      var frames = Array.from(document.querySelectorAll(sel));
      var iframe = frames[${index}];
      if (!iframe) return null;
      var card = iframe;
      for (var k = 0; k < 3 && card.parentElement; k++) card = card.parentElement;
      card.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise(function(r){ setTimeout(r, ${SCROLL_SETTLE_MS}); });
      var r = card.getBoundingClientRect();
      return {
        cx: Math.round(r.x + r.width / 2),
        cy: Math.round(r.y + r.height / 2),
        trX: Math.round(r.x + r.width - 30),
        trY: Math.round(r.y + 30),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    })()
  `;
  const r = await webview.executeJavaScript(script);
  return r || null;
}

/**
 * Atomic operation: hover over artifact card, open the "..." menu, click
 * one of its three items, return success.
 *
 * Does NOT reset the mouse afterwards — caller does that, because reading
 * the clipboard (or download buffer) should happen before moving away.
 */
export async function clickArtifactMenuItem(
  webview: Electron.WebviewTag,
  view: ViewAPILike,
  index: number,
  item: MenuItem,
): Promise<{ ok: boolean; reason?: string }> {
  const coords = await scrollAndReadRect(webview, index);
  if (!coords) return { ok: false, reason: `no artifact at index ${index}` };

  const { cx, cy, trX, trY } = coords;

  // Hover trajectory: outside → center → top-right. Required — Radix UI
  // won't open the menu on a single mouseMoved to the hotspot.
  const moveOk = await view.wbSendMouse([
    { type: 'mouseMoved', x: cx - 400, y: cy, button: 'none', buttons: 0 },
    { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 },
    { type: 'mouseMoved', x: trX, y: trY, button: 'none', buttons: 0 },
  ]);
  if (!moveOk.success) return { ok: false, reason: 'wbSendMouse failed: ' + moveOk.error };
  await sleep(HOVER_SETTLE_MS);

  // Menu is now open. Target item coords are estimated from the trigger
  // position — the menu itself lives inside the cross-origin iframe and
  // is not queryable from the parent document.
  const off = MENU_OFFSETS[item];
  const itemX = trX + off.dx;
  const itemY = trY + off.dy;

  // mouseMoved to item first (keeps menu open + triggers hover highlight),
  // then mousePressed + mouseReleased.
  await view.wbSendMouse([{ type: 'mouseMoved', x: itemX, y: itemY, button: 'none', buttons: 0 }]);
  await sleep(PRE_CLICK_HOLD_MS);
  await view.wbSendMouse([
    { type: 'mousePressed', x: itemX, y: itemY, button: 'left', buttons: 1, clickCount: 1 },
    { type: 'mouseReleased', x: itemX, y: itemY, button: 'left', buttons: 0, clickCount: 1 },
  ]);
  await sleep(POST_CLICK_WAIT_MS);

  return { ok: true };
}

/** Move the synthetic mouse pointer to the top-left corner to avoid
 *  interfering with user actions after an extraction run. */
export async function resetMouse(view: ViewAPILike): Promise<void> {
  try {
    await view.wbSendMouse([{ type: 'mouseMoved', x: 5, y: 5, button: 'none', buttons: 0 }]);
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// Per-button extractors
// ─────────────────────────────────────────────────────────────

/**
 * Extract the Nth artifact as a rendered PNG image by clicking "Copy to
 * clipboard" and reading the system clipboard.
 *
 * Returns null if the menu didn't open, the click missed the menu item,
 * or the clipboard didn't receive an image within the wait window.
 */
export async function extractArtifactImage(
  webview: Electron.WebviewTag,
  view: ViewAPILike,
  index: number,
): Promise<ArtifactImage | null> {
  const r = await clickArtifactMenuItem(webview, view, index, 'copy');
  if (!r.ok) {
    await resetMouse(view);
    return null;
  }
  const img = await view.wbReadClipboardImage();
  await resetMouse(view);
  if (!img.success || !img.dataUrl || !img.width || !img.height) return null;
  return { dataUrl: img.dataUrl, width: img.width, height: img.height };
}

/**
 * Extract the Nth artifact's HTML source by clicking "Download file" and
 * capturing the resulting download via the main-process will-download
 * hook (see IPC.WB_CAPTURE_DOWNLOAD_ONCE).
 *
 * NOTE: This function requires the main-process download capture to be
 * armed before the click. Wire-up is implemented but not exposed to the
 * renderer API yet — `viewAPI.wbCaptureDownloadOnce` will be added when
 * module 5 consumes this function. Until then, callers should treat this
 * as reserved surface.
 */
export async function extractArtifactSource(
  webview: Electron.WebviewTag,
  view: ViewAPILike & {
    wbCaptureDownloadOnce?: (timeoutMs?: number) => Promise<{
      success: boolean; filename?: string; mimeType?: string; content?: string; error?: string;
    }>;
  },
  index: number,
): Promise<ArtifactSource | null> {
  if (!view.wbCaptureDownloadOnce) {
    // Interface is defined but renderer API not wired yet — by design.
    return null;
  }

  // Arm the main-side one-shot handler BEFORE clicking, so it races with
  // the will-download event.
  const capturePromise = view.wbCaptureDownloadOnce(10_000);

  const r = await clickArtifactMenuItem(webview, view, index, 'download');
  if (!r.ok) {
    await resetMouse(view);
    return null;
  }

  const dl = await capturePromise;
  await resetMouse(view);
  if (!dl.success || !dl.content) return null;
  return {
    content: dl.content,
    filename: dl.filename || 'artifact.html',
    mimeType: dl.mimeType || 'text/html',
  };
}

/**
 * Trigger "Save as artifact" on the Nth artifact. KRIG does not read the
 * result — this only affects the user's Claude-side library. Exposed for
 * future "one-click cloud backup" use cases.
 */
export async function triggerArtifactSave(
  webview: Electron.WebviewTag,
  view: ViewAPILike,
  index: number,
): Promise<boolean> {
  const r = await clickArtifactMenuItem(webview, view, index, 'save');
  await resetMouse(view);
  return r.ok;
}

// ─────────────────────────────────────────────────────────────
// Batch
// ─────────────────────────────────────────────────────────────

/**
 * Extract all artifacts on the page, honoring the requested options.
 *
 * Artifacts are processed sequentially because each one briefly takes
 * over the viewport (scrollIntoView) and the clipboard. Parallel
 * extraction would race and is not attempted.
 */
export async function extractAll(
  webview: Electron.WebviewTag,
  view: ViewAPILike & {
    wbCaptureDownloadOnce?: (timeoutMs?: number) => Promise<{
      success: boolean; filename?: string; mimeType?: string; content?: string; error?: string;
    }>;
  },
  opts: ExtractOptions = { image: true },
  /**
   * If set, only the LAST `tail` descriptors are processed. Used by sync
   * mode to grab only the iframes belonging to the just-completed turn,
   * since older artifacts from previous turns are still in the DOM.
   */
  tail?: number,
): Promise<ExtractedArtifact[]> {
  const descriptors = await listArtifacts(webview);
  const slice = typeof tail === 'number' && tail > 0 && tail < descriptors.length
    ? descriptors.slice(descriptors.length - tail)
    : descriptors;
  const results: ExtractedArtifact[] = [];
  for (const d of slice) {
    const row: ExtractedArtifact = { ...d };
    if (opts.image) row.image = await extractArtifactImage(webview, view, d.index);
    if (opts.source) row.source = await extractArtifactSource(webview, view, d.index);
    if (opts.save) row.saved = await triggerArtifactSave(webview, view, d.index);
    results.push(row);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// Debug / manual test hook
// ─────────────────────────────────────────────────────────────

/**
 * Extract the page's first artifact via the Copy-to-clipboard path.
 * Intended for a manual test button in the UI — it prints a compact
 * diagnostic and returns enough information for the caller to preview
 * the image (e.g. open a window with `<img src={dataUrl}>`).
 *
 * Returns null when the page has no artifacts.
 */
export async function debugExtractFirstArtifact(
  webview: Electron.WebviewTag,
  view: ViewAPILike,
): Promise<{ descriptor: ArtifactDescriptor; image: ArtifactImage | null } | null> {
  const descriptors = await listArtifacts(webview);
  if (descriptors.length === 0) return null;
  const descriptor = descriptors[0];
  const image = await extractArtifactImage(webview, view, 0);
  return { descriptor, image };
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
