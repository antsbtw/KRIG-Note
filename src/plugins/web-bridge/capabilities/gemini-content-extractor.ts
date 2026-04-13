/**
 * Gemini Content Extractor — self-contained Gemini-only module
 *
 * Single entry point for extracting everything Gemini produces in a
 * conversation: text, LaTeX, code blocks, tables, Imagen images,
 * thinking chains, and web-search groundings.
 *
 * Public surface (stable):
 *   - extractContent(webview, view)        — structured snapshot of current conversation
 *   - debugExtractContent(webview, view)   — manual test hook (AIWebView 🧪 Gemini button)
 *
 * ─────────────────────────────────────────────────────────────
 * Why CDP?
 * ─────────────────────────────────────────────────────────────
 *
 * Gemini's `/_/BardChatUi/data/batchexecute?rpcids=...` requests are
 * issued from within the framework (similar to ChatGPT's Service Worker
 * setup) and are not observable via page-level fetch / XHR hooks. The
 * CDP interceptor captures the raw batchexecute responses; we parse the
 * response's multi-frame stream, unwrap the JSON-inside-string payload,
 * and walk the positional array tree.
 *
 * ─────────────────────────────────────────────────────────────
 * batchexecute response format
 * ─────────────────────────────────────────────────────────────
 *
 *   )]}'
 *   <frame_length_bytes>\n
 *   <json_array_frame>\n
 *   <frame_length_bytes>\n
 *   <json_array_frame>\n
 *   ...
 *
 * Frame length is declared in UTF-8 BYTES, not JS character count, which
 * makes length-based slicing fragile (JS strings are UTF-16). We avoid
 * the issue by greedy-parsing: from each frame's start, scan forward to
 * the next /\n\d+\n/ boundary (or EOF) and `JSON.parse` that chunk.
 *
 * Each frame is `[["wrb.fr", "<rpcId>", "<inner_json_string>", ...], ...]`.
 * `inner_json_string` is itself a JSON string that must be re-parsed.
 *
 * ─────────────────────────────────────────────────────────────
 * hNvQHb inner schema (empirically verified, 2026-04-13)
 * ─────────────────────────────────────────────────────────────
 *
 *   inner[0]                       = turn array (NEWEST FIRST — reverse before use)
 *     inner[0][i][0]               = [conversationId, thisResponseId]
 *     inner[0][i][1]               = [conversationId, prevResponseId, rcId] | null (null = first turn)
 *     inner[0][i][2][0][0]         = user message text
 *     inner[0][i][3]               = assistant payload container (length ~25)
 *       inner[0][i][3][0][0][1][0]       = assistant markdown (complete, ready-to-render)
 *       inner[0][i][3][0][0][37][0][0]   = thinking chain text
 *       inner[0][i][3][0][0][12][7][0][0][0] = Imagen image group (array of slots,
 *                                               each slot has URL at [...][3])
 *       inner[0][i][3][12][0][0][14][12]  = search grounding entries
 *     inner[0][i][4]               = [unix_sec, nanos]
 *
 * Paths may vary slightly with Gemini frontend updates; if extraction
 * starts silently returning empty fields, re-run the debug probe (see
 * docs/web/Gemini-Content-Extraction-Problem.md §侦察脚本) and update
 * the path constants below.
 *
 * ─────────────────────────────────────────────────────────────
 * Prerequisite: CDP interception must be running
 * ─────────────────────────────────────────────────────────────
 *
 * Callers must start CDP capture before the hNvQHb response flows.
 * Recommended flow:
 *   1. Navigate to the Gemini conversation
 *   2. Start CDP (📡 CDP 抓包)
 *   3. Reload the page (Cmd+R) so hNvQHb is re-fetched and captured
 *   4. Call extractContent()
 *
 * ─────────────────────────────────────────────────────────────
 * Image download: why main-process net.fetch, not renderer
 * ─────────────────────────────────────────────────────────────
 *
 * Gemini Imagen images live at `lh3.googleusercontent.com/gg/AEir0w...`.
 * Every renderer-side approach failed during investigation (2026-04-13):
 *
 *   guest fetch(url, {credentials: 'include'}) → HTTP 400 text/html
 *   guest fetch(url, {credentials: 'omit'})    → HTTP 400
 *   guest fetch(url, {mode: 'no-cors'})        → opaque, body size 0
 *   new Image() with crossOrigin='anonymous'   → img.onerror
 *   new Image() without crossOrigin            → loads, but canvas tainted
 *                                                → toDataURL throws SecurityError
 *
 * Electron main-process `net.fetch` has no CORS layer and sends a
 * minimal request the lh3 CDN accepts, so we route image downloads
 * through WB_FETCH_BINARY (main-side IPC) and wrap the base64 body as
 * a data URL. DO NOT replace this with renderer fetch / img-canvas —
 * each has been verified broken against real Gemini outputs.
 *
 * ─────────────────────────────────────────────────────────────
 * Module status (2026-04-13)
 * ─────────────────────────────────────────────────────────────
 *
 *   Verified end-to-end against a 5-sample conversation:
 *     LaTeX prose, Python code block, comparison table, web-search
 *     grounding with citations, and Imagen image pair.
 *
 *   - Images are fetched as bytes (main-process) and inlined as base64
 *     data URLs. Gemini's lh3 URLs are short-lived so inlining is the
 *     only way to make notes durable.
 *   - Groundings are appended as a "## 参考来源" section to the markdown.
 *   - Thinking chain is returned as a separate `thinking` field (not
 *     inserted into markdown by default).
 *   - Turn order is reversed to chronological (oldest first), matching
 *     the Claude/ChatGPT extractors.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface GeminiGrounding {
  title: string;
  url: string;
}

export interface GeminiTurn {
  conversationId: string;
  responseId: string;
  /** User's original message text. */
  userText: string;
  /**
   * Complete assistant Markdown with groundings appended as a
   * `## 参考来源` section (if any). Suitable for direct rendering.
   */
  markdown: string;
  /** Assistant's internal thinking chain (raw, often verbose). */
  thinking: string | null;
  /**
   * Image assets (Imagen). Each entry carries the original URL plus a
   * base64 data URL when the fetch succeeded.
   */
  images: Array<{ url: string; dataUrl: string | null; mimeType: string }>;
  /** Web-search grounding entries (raw — also appended to markdown). */
  groundings: GeminiGrounding[];
  /** Unix seconds when this turn was created. */
  createdAt: number;
}

export interface GeminiContent {
  conversationId: string | null;
  /** Turns in chronological order (oldest first). */
  turns: GeminiTurn[];
  warnings: string[];
}

// Minimal contract we need from renderer's viewAPI surface.
interface ViewAPILike {
  wbCdpFindResponse: (params: { urlSubstring: string; mode?: 'all' | 'latest' | 'first' }) =>
    Promise<{ success: boolean; error?: string; count?: number; matches?: Array<{
      url: string; statusCode: number; mimeType: string;
      body: string | null; bodyLength: number; timestamp: number;
    }> }>;
  wbFetchBinary: (params: { url: string; headers?: Record<string, string>; timeoutMs?: number }) =>
    Promise<{ success: boolean; base64?: string; mimeType?: string; bodyLength?: number; error?: string }>;
}

// ─────────────────────────────────────────────────────────────
// URL / id helpers
// ─────────────────────────────────────────────────────────────

/** Matches gemini.google.com/app/{convHash}. */
export function extractConversationId(url: string): string | null {
  const m = url.match(/gemini\.google\.com\/app\/([a-f0-9]+)/);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────────────────────────
// batchexecute frame parser
// ─────────────────────────────────────────────────────────────

/**
 * Parse a batchexecute response body into an array of frames, each frame
 * being the decoded JSON of one chunk. The body format is:
 *   )]}'
 *   <len>\n<json>\n<len>\n<json>\n...
 *
 * We ignore the declared `<len>` because it's measured in UTF-8 bytes
 * while JS strings are UTF-16 code units. Instead we greedy-parse: at
 * each frame boundary, take every character up to the next
 * `\n<digits>\n` and `JSON.parse` it.
 */
function parseBatchExecute(body: string): any[] {
  let rest = body;
  if (rest.startsWith(")]}'")) rest = rest.slice(4);
  rest = rest.replace(/^\s+/, '');

  const frames: any[] = [];
  while (rest.length > 0) {
    const nl = rest.indexOf('\n');
    if (nl < 0) break;
    const header = rest.slice(0, nl).trim();
    if (!/^\d+$/.test(header)) break;
    rest = rest.slice(nl + 1);
    // Greedy: everything until the next frame header or EOF
    const next = rest.search(/\n\d+\n/);
    const chunk = next < 0 ? rest : rest.slice(0, next);
    try {
      frames.push(JSON.parse(chunk));
      rest = next < 0 ? '' : rest.slice(next + 1);
    } catch {
      break;
    }
  }
  return frames;
}

/**
 * Pick the inner payload of a specific rpcId from a parsed frame list.
 * Each frame's `wrb.fr` row has shape
 *   ["wrb.fr", "<rpcId>", "<inner_json_string>", ...]
 * We re-parse `inner_json_string` to get the real data.
 */
function pickRpcInner(frames: any[], rpcId: string): any | null {
  for (const frame of frames) {
    if (!Array.isArray(frame)) continue;
    for (const row of frame) {
      if (Array.isArray(row) && row[0] === 'wrb.fr' && row[1] === rpcId && typeof row[2] === 'string') {
        try { return JSON.parse(row[2]); } catch { return null; }
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// hNvQHb turn parsing
// ─────────────────────────────────────────────────────────────

/**
 * Safely index into a nested array by path. Returns undefined at any
 * missing link. `arr.at(-1)` etc. are not supported — integer indices
 * only.
 */
function getPath(obj: any, path: (number | string)[]): any {
  let cur = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k as any];
  }
  return cur;
}

/**
 * Collect Imagen image URLs from turn[3][0][0][12][7][0][0][0].
 * The slot array contains image blocks; each block has its public URL
 * at position [3] (a string starting with https://lh3.googleusercontent.com).
 */
function collectImageUrls(turnAssistant: any): string[] {
  const group = getPath(turnAssistant, [0, 0, 12, 7, 0, 0, 0]);
  if (!Array.isArray(group)) return [];
  const urls: string[] = [];
  for (const slot of group) {
    const u = getPath(slot, [3]);
    if (typeof u === 'string' && u.startsWith('https://lh3.')) urls.push(u);
  }
  return urls;
}

/**
 * Collect web-search groundings (title + URL pairs) from
 * turn[3][12][0][0][14][12]. Each entry's title is at [0][0][1][2] and
 * its URL at [0][0][1][3][1][2][1][0].
 */
function collectGroundings(turnAssistant: any): GeminiGrounding[] {
  const entries = getPath(turnAssistant, [12, 0, 0, 14, 12]);
  if (!Array.isArray(entries)) return [];
  const out: GeminiGrounding[] = [];
  for (const e of entries) {
    const title = getPath(e, [0, 0, 1, 2]);
    const url = getPath(e, [0, 0, 1, 3, 1, 2, 1, 0]);
    if (typeof title === 'string' && typeof url === 'string' && url.startsWith('http')) {
      out.push({ title, url });
    }
  }
  return out;
}

/**
 * Append groundings as a `## 参考来源` section to the assistant markdown.
 * Idempotent — if groundings is empty, returns markdown unchanged.
 */
function appendGroundings(markdown: string, groundings: GeminiGrounding[]): string {
  if (groundings.length === 0) return markdown;
  const lines = ['', '', '---', '', '## 参考来源', ''];
  for (let i = 0; i < groundings.length; i++) {
    const g = groundings[i];
    lines.push(`${i + 1}. [${g.title}](${g.url})`);
  }
  return markdown + lines.join('\n');
}

/**
 * Normalize a single raw turn into a GeminiTurn. Does NOT fetch images
 * — that's done in the batch stage to allow parallel requests.
 */
function normalizeTurn(raw: any): GeminiTurn | null {
  const convId = getPath(raw, [0, 0]);
  const respId = getPath(raw, [0, 1]);
  const userText = getPath(raw, [2, 0, 0]);
  const assistant = getPath(raw, [3]);
  const markdown = getPath(assistant, [0, 0, 1, 0]) || '';
  const thinking = getPath(assistant, [0, 0, 37, 0, 0]) || null;
  const tsSec = getPath(raw, [4, 0]);

  if (typeof convId !== 'string' || typeof respId !== 'string') return null;

  const imageUrls = collectImageUrls(assistant);
  const groundings = collectGroundings(assistant);

  return {
    conversationId: convId,
    responseId: respId,
    userText: typeof userText === 'string' ? userText : '',
    markdown: appendGroundings(typeof markdown === 'string' ? markdown : '', groundings),
    thinking: typeof thinking === 'string' ? thinking : null,
    images: imageUrls.map(url => ({ url, dataUrl: null, mimeType: 'image/png' })),
    groundings,
    createdAt: typeof tsSec === 'number' ? tsSec : 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Image fetch → base64 data URL
// ─────────────────────────────────────────────────────────────

/**
 * Download an image URL via the MAIN process and return it as a base64
 * data URL.
 *
 * Why main-process fetch: Gemini's lh3.googleusercontent.com URLs reject
 * renderer-side access from every angle we tested:
 *   - fetch(url, {credentials: 'include' | 'omit'})  → HTTP 400 text/html
 *   - fetch(url, {mode: 'no-cors'})                  → opaque, zero-byte body
 *   - new Image() with crossOrigin='anonymous'       → onerror (CORS denial)
 *   - new Image() without crossOrigin                → loads but canvas is tainted, toDataURL throws
 *
 * Electron's main-process net.fetch has no CORS layer and sends a
 * minimal request that the lh3 CDN accepts. We call it via
 * WB_FETCH_BINARY and wrap the base64 body as a data URL.
 *
 * Returns null on any failure; caller keeps the original URL.
 */
async function fetchImageAsDataUrl(
  view: ViewAPILike,
  url: string,
): Promise<{ dataUrl: string; mimeType: string } | null> {
  try {
    const r = await view.wbFetchBinary({ url, timeoutMs: 15_000 });
    if (!r.success || !r.base64) return null;
    const mime = r.mimeType && r.mimeType.startsWith('image/') ? r.mimeType : 'image/png';
    return { dataUrl: `data:${mime};base64,${r.base64}`, mimeType: mime };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Core extractor
// ─────────────────────────────────────────────────────────────

/**
 * Extract a structured snapshot of the current Gemini conversation from
 * the CDP response cache. Does not emit outbound conversation traffic
 * (only image URL fetches).
 */
export async function extractContent(
  webview: Electron.WebviewTag,
  view: ViewAPILike,
): Promise<GeminiContent> {
  const warnings: string[] = [];
  const url = webview.getURL?.() || '';
  const conversationId = extractConversationId(url);

  const out: GeminiContent = {
    conversationId,
    turns: [],
    warnings,
  };

  if (!conversationId) {
    warnings.push('Not on a Gemini conversation page (URL must contain /app/{hash}).');
    return out;
  }

  // ── Find the largest hNvQHb response in CDP cache ──
  // Multiple requests may have been captured; the full conversation
  // reload is always the biggest.
  const resp = await view.wbCdpFindResponse({ urlSubstring: 'rpcids=hNvQHb', mode: 'all' });
  if (!resp.success) {
    warnings.push('CDP not running — start "📡 CDP 抓包" and reload the page.');
    return out;
  }
  const candidates = (resp.matches || []).filter(m => m.body && m.bodyLength > 5000);
  if (candidates.length === 0) {
    warnings.push('No hNvQHb response in CDP cache. Reload the Gemini page after starting CDP.');
    return out;
  }
  candidates.sort((a, b) => b.bodyLength - a.bodyLength);
  const biggest = candidates[0];

  // ── Parse frames → inner ──
  const frames = parseBatchExecute(biggest.body!);
  if (frames.length === 0) {
    warnings.push('Failed to parse batchexecute frames.');
    return out;
  }
  const inner = pickRpcInner(frames, 'hNvQHb');
  if (!Array.isArray(inner) || !Array.isArray(inner[0])) {
    warnings.push('hNvQHb inner payload has unexpected shape.');
    return out;
  }

  // ── Normalize turns (newest first → reverse for chronological order) ──
  const turnsRaw = inner[0];
  const turns: GeminiTurn[] = [];
  for (const raw of turnsRaw) {
    const t = normalizeTurn(raw);
    if (t) turns.push(t);
  }
  turns.reverse();

  // ── Inline image bytes in parallel ──
  // Gemini's lh3 URLs are short-lived; base64 inlining is required for
  // durable notes. We fetch all images concurrently to stay fast on
  // multi-image turns.
  const allImageFetches = turns.flatMap(turn =>
    turn.images.map(async (img) => {
      const r = await fetchImageAsDataUrl(view, img.url);
      if (r) {
        img.dataUrl = r.dataUrl;
        img.mimeType = r.mimeType;
      } else {
        warnings.push(`Failed to fetch image ${img.url.slice(0, 80)}…`);
      }
    }),
  );
  await Promise.all(allImageFetches);

  out.turns = turns;
  return out;
}

// ─────────────────────────────────────────────────────────────
// Debug / manual test hook
// ─────────────────────────────────────────────────────────────

/**
 * Extract and log a concise summary. Returns the full content for the
 * caller (typically AIWebView's 🧪 Gemini debug button) to build a
 * preview window.
 */
export async function debugExtractContent(
  webview: Electron.WebviewTag,
  view: ViewAPILike,
): Promise<GeminiContent> {
  const c = await extractContent(webview, view);
  // eslint-disable-next-line no-console
  console.log('[GeminiExtract] convId:', c.conversationId, 'turns:', c.turns.length);
  c.turns.forEach((t, i) => {
    // eslint-disable-next-line no-console
    console.log(`[GeminiExtract] turn[${i}]`, {
      user: t.userText.slice(0, 40),
      markdownLen: t.markdown.length,
      thinkingLen: t.thinking?.length ?? 0,
      images: t.images.length,
      imagesWithData: t.images.filter(img => img.dataUrl).length,
      groundings: t.groundings.length,
      createdAt: t.createdAt,
    });
  });
  if (c.warnings.length) {
    // eslint-disable-next-line no-console
    console.warn('[GeminiExtract] warnings:', c.warnings);
  }
  return c;
}
