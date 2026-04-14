/**
 * ChatGPT Content Extractor — self-contained ChatGPT-only module
 *
 * Single entry point for extracting everything ChatGPT produces in a
 * conversation: text (with LaTeX / code blocks), Canvas documents,
 * DALL·E images, Code Interpreter outputs, and any referenced files.
 *
 * Public surface (stable):
 *   - extractContent(webview, view)        — structured snapshot of current conversation
 *   - debugExtractContent(webview, view)   — manual test hook (AIWebView 🧪 ChatGPT button)
 *
 * ─────────────────────────────────────────────────────────────
 * Why CDP instead of fetch()?
 * ─────────────────────────────────────────────────────────────
 *
 * ChatGPT routes all `/backend-api/...` traffic through a Service Worker
 * that injects auth headers the page itself cannot see. A page-level
 * `fetch('/backend-api/conversation/{id}')` returns **401**, so extraction
 * has to observe responses, not initiate them.
 *
 * The CDP interceptor (see capabilities/cdp-interceptor.ts) records every
 * response body on the guest webContents. Binary responses (PNG images)
 * are returned as base64 strings — this module composes them into data
 * URLs directly without additional transcoding.
 *
 * ─────────────────────────────────────────────────────────────
 * Data sources mapped to ChatGPT features
 * ─────────────────────────────────────────────────────────────
 *
 * | Feature                    | URL pattern                                       |
 * |----------------------------|---------------------------------------------------|
 * | Conversation tree (text)   | /backend-api/conversation/{uuid}                  |
 * | Canvas documents           | /backend-api/conversation/{uuid}/textdocs         |
 * | File bytes (images, CSVs)  | /backend-api/estuary/content?id=file_{id}&...     |
 * | File metadata              | /backend-api/files/download/{file_id}             |
 *
 * LaTeX appears inline in conversation text as `\[...\]` / `\(...\)`.
 * Code blocks appear as standard fenced ` ```lang\ncode\n``` ` in text.
 * Canvas content is full Markdown — code blocks inside it use the same
 * fenced syntax. There's no separate "code canvas" type; a React file
 * checked into Canvas is just a Markdown ` ```jsx ... ``` ` block.
 *
 * ─────────────────────────────────────────────────────────────
 * Prerequisite: CDP interception must be running
 * ─────────────────────────────────────────────────────────────
 *
 * Callers must start CDP (via `📡 CDP 抓包` button or `wbCdpStart`) before
 * the relevant responses flow. The recommended flow:
 *   1. User navigates to the ChatGPT conversation
 *   2. Start CDP
 *   3. Reload the page (so conversation/textdocs/files are all re-fetched
 *      and captured)
 *   4. Call extractContent()
 *
 * ─────────────────────────────────────────────────────────────
 * Key discoveries (DO NOT revert without re-verifying)
 * ─────────────────────────────────────────────────────────────
 *
 *   1. Page-level `fetch('/backend-api/...')` returns 401. Auth lives in
 *      the Service Worker. Use CDP capture, not active fetch.
 *
 *   2. `/backend-api/conversation/{uuid}` is a prefix of
 *      `/conversation/{uuid}/textdocs` and `/stream_status`. Filter by
 *      exact tail (empty or query-only) to pick the bare conversation.
 *
 *   3. Code Interpreter images are NOT in `content.parts` — they live at
 *      `metadata.aggregate_result.messages[].image_url`, pointer shape
 *      `file-service://file_<hex>`.
 *
 *   4. DALL·E images use `sediment://file_<hex>` in `content.parts[].
 *      asset_pointer`.
 *
 *   5. The file id regex must be `file_[A-Za-z0-9]+` (underscore only).
 *      A looser `file[-_]` matches the literal string "file-service"
 *      inside the scheme, corrupting the id.
 *
 *   6. `/backend-api/estuary/content?id=...` returns images with
 *      `Content-Type: application/octet-stream`. `<img>` rejects that
 *      data URL. We sniff the real MIME from base64 magic bytes
 *      (PNG iVBORw / JPEG /9j/ / GIF R0lGODl / WebP UklGR / ...).
 *
 * ─────────────────────────────────────────────────────────────
 * Verified coverage (2026-04-13)
 * ─────────────────────────────────────────────────────────────
 *
 *   Sample conversation with 6 content types — all extracted correctly:
 *     1. LaTeX in prose            → conversation.parts (text, `\[...\]`)
 *     2. Fenced code block         → conversation.parts (markdown text)
 *     3. matplotlib heatmap        → metadata.aggregate_result image_url
 *                                    → estuary bytes (base64) → data URL
 *     4. DALL·E image              → content.parts[].asset_pointer
 *                                    → estuary bytes → data URL
 *     5. Canvas document           → /textdocs → `content` field (markdown)
 *     6. Canvas code (React)       → same as 5, just a fenced ```jsx block
 *
 * Module status (2026-04-13):
 *   - extractContent: verified end-to-end against all six sample types
 *   - No DOM fallback — if CDP cache is empty, extractContent returns an
 *     empty result with a warning rather than scraping DOM.
 *   - No active reload — caller must start CDP and refresh the page
 *     themselves so the responses are captured.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ChatGPTMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  author: string | null;
  createdAt: number | null;
  contentType: string;
  /** Joined text (for text/markdown parts). Empty string if none. */
  text: string;
  /** Inline code blocks parsed from `text`. Kept for convenience. */
  codeBlocks: Array<{ language: string; code: string }>;
  /** Any file ids referenced by this message (asset_pointer / attachments). */
  fileRefs: string[];
  /** True if this is a hidden system message that shouldn't be shown. */
  hidden: boolean;
  /** Raw metadata keys present, for future compatibility. */
  metaKeys: string[];
  /** `recipient` field (e.g. "all", "python", "dalle.text2im"). */
  recipient: string | null;
}

export interface ChatGPTTextdoc {
  id: string;
  version: number;
  title: string;
  textdocType: string;
  content: string;
}

export interface ChatGPTFile {
  fileId: string;
  mimeType: string;
  /** `data:<mime>;base64,<...>` — assembled from CDP-captured base64 body. */
  dataUrl: string | null;
  bodyLength: number;
}

export interface ChatGPTContent {
  conversationId: string | null;
  title: string;
  messages: ChatGPTMessage[];
  textdocs: ChatGPTTextdoc[];
  files: Record<string, ChatGPTFile>;
  /** Non-fatal warnings (missing responses, parse issues, etc.). */
  warnings: string[];
}

// Minimal contract we need from the renderer's viewAPI surface.
interface ViewAPILike {
  wbCdpFindResponse: (params: { urlSubstring: string; mode?: 'all' | 'latest' | 'first' }) =>
    Promise<{ success: boolean; error?: string; count?: number; matches?: Array<{
      url: string; statusCode: number; mimeType: string;
      body: string | null; bodyLength: number; timestamp: number;
    }> }>;
}

// ─────────────────────────────────────────────────────────────
// URL / ID helpers
// ─────────────────────────────────────────────────────────────

/** Matches both chat.openai.com/c/{uuid} and chatgpt.com/c/{uuid}. */
export function extractConversationId(url: string): string | null {
  const m = url.match(/\/c\/([a-f0-9-]{36})/);
  return m ? m[1] : null;
}

/**
 * Identify an image's real MIME type from its base64-encoded body by
 * inspecting the first few decoded bytes. ChatGPT's estuary endpoint
 * returns `application/octet-stream` for images, which breaks data-URL
 * rendering in `<img>`.
 *
 * Returns null when the signature is unrecognized — callers fall back to
 * the server-reported MIME or octet-stream.
 */
function sniffMimeFromBase64(b64: string | null | undefined): string | null {
  if (!b64 || typeof b64 !== 'string' || b64.length < 8) return null;
  // Deterministic base64 prefixes of common formats:
  //   PNG "\x89PNG..."          → iVBORw
  //   JPEG "\xFF\xD8..."         → /9j/
  //   GIF87a/89a                 → R0lGODl
  //   WebP (starts "RIFF...WEBP") → UklGR
  //   SVG (XML)                  → PHN2Zy  or  PD94bWw
  //   PDF                        → JVBER
  const head = b64.slice(0, 16);
  if (head.startsWith('iVBORw')) return 'image/png';
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('R0lGODl')) return 'image/gif';
  if (head.startsWith('UklGR')) return 'image/webp';
  if (head.startsWith('PHN2Zy') || head.startsWith('PD94bWw')) return 'image/svg+xml';
  if (head.startsWith('JVBER')) return 'application/pdf';
  return null;
}

/**
 * Extract a canonical `file_<hex>` id from any pointer ChatGPT uses:
 *   file-service://file_XXX     (Code Interpreter image_url)
 *   sediment://file_XXX          (DALL·E image_asset_pointer)
 *   file_XXX                     (direct attachment id)
 *
 * Note: `file-service` contains a hyphen, so a loose `file[-_]` regex would
 * match the scheme. We anchor on `file_` (underscore only) to only match the
 * actual file id.
 */
function fileIdFromAssetPointer(ptr: string | undefined | null): string | null {
  if (!ptr || typeof ptr !== 'string') return null;
  const m = ptr.match(/file_[A-Za-z0-9]+/);
  return m ? m[0] : null;
}

/** Extract file id from an estuary content URL query string. */
function fileIdFromEstuaryUrl(url: string): string | null {
  const m = url.match(/[?&]id=(file_[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────────────────────────
// Conversation tree walk
// ─────────────────────────────────────────────────────────────

/**
 * Walk ChatGPT's conversation mapping tree (parent→children graph),
 * following the last child at each node. Returns messages in display
 * order (oldest first).
 */
function walkMapping(mapping: Record<string, any>): any[] {
  let rootId: string | null = null;
  for (const k of Object.keys(mapping)) {
    if (!mapping[k].parent) { rootId = k; break; }
  }
  const ordered: any[] = [];
  let cur: string | null = rootId;
  while (cur && mapping[cur]) {
    const node = mapping[cur];
    if (node.message) ordered.push(node.message);
    const children: string[] = node.children || [];
    cur = children.length ? children[children.length - 1] : null;
  }
  return ordered;
}

/** Parse fenced code blocks out of a Markdown string. */
function parseCodeBlocks(md: string): Array<{ language: string; code: string }> {
  const blocks: Array<{ language: string; code: string }> = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    blocks.push({ language: m[1] || '', code: m[2] });
  }
  return blocks;
}

/**
 * Normalize a raw ChatGPT message into our flat shape. Extracts:
 *   - `text` from string parts (joined)
 *   - `fileRefs` from `asset_pointer` parts and `metadata.attachments`
 *   - visibility from `metadata.is_visually_hidden_from_conversation`
 */
function normalizeMessage(raw: any): ChatGPTMessage {
  const author = raw.author?.role || 'unknown';
  const recipient: string | null = raw.recipient ?? null;
  const contentType = raw.content?.content_type || 'text';
  const parts = raw.content?.parts || [];

  const textParts: string[] = [];
  const fileRefs: string[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      if (p.length > 0) textParts.push(p);
    } else if (p && typeof p === 'object') {
      if (p.asset_pointer) {
        const id = fileIdFromAssetPointer(p.asset_pointer);
        if (id) fileRefs.push(id);
      }
    }
  }

  // attachments in metadata (user uploads)
  const attachments = raw.metadata?.attachments;
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (a && a.id && /^file_/.test(a.id)) fileRefs.push(a.id);
    }
  }

  // Code Interpreter (python tool) outputs: images are nested under
  // metadata.aggregate_result.messages[].image_url, shaped like
  // "file-service://file_XXX". Scan for any such URL.
  const agg = raw.metadata?.aggregate_result;
  if (agg && Array.isArray(agg.messages)) {
    for (const m of agg.messages) {
      if (typeof m?.image_url === 'string') {
        const id = fileIdFromAssetPointer(m.image_url);
        if (id) fileRefs.push(id);
      }
    }
  }

  const text = textParts.join('\n\n');
  const codeBlocks = parseCodeBlocks(text);
  const metaKeys = raw.metadata ? Object.keys(raw.metadata) : [];
  const hidden = !!raw.metadata?.is_visually_hidden_from_conversation;

  return {
    id: raw.id,
    role: (author === 'user' || author === 'assistant' || author === 'tool' || author === 'system') ? author : 'system',
    author: raw.author?.name ?? author,
    createdAt: raw.create_time ?? null,
    contentType,
    text,
    codeBlocks,
    fileRefs: Array.from(new Set(fileRefs)),
    hidden,
    metaKeys,
    recipient,
  };
}

// ─────────────────────────────────────────────────────────────
// Core extractor
// ─────────────────────────────────────────────────────────────

/**
 * Extract a structured snapshot of the current ChatGPT conversation from
 * the CDP response cache. Does not emit network traffic.
 *
 * Resolution order for each data class:
 *   1. Find latest matching response in CDP cache
 *   2. Parse JSON (conversation, textdocs) or wrap base64 as data URL (files)
 *   3. Collect file ids referenced by messages; fetch only those bytes
 */
export async function extractContent(
  webview: Electron.WebviewTag,
  view: ViewAPILike,
): Promise<ChatGPTContent> {
  const warnings: string[] = [];
  const url = webview.getURL?.() || '';
  const conversationId = extractConversationId(url);

  const out: ChatGPTContent = {
    conversationId,
    title: '',
    messages: [],
    textdocs: [],
    files: {},
    warnings,
  };

  if (!conversationId) {
    warnings.push('Not on a ChatGPT conversation page (no /c/{uuid} in URL).');
    return out;
  }

  // ── Conversation tree ─────────────────────────────────────
  // `/backend-api/conversation/{uuid}` is a prefix of
  // `/backend-api/conversation/{uuid}/textdocs`, `/stream_status`, etc.
  // We fetch all matches and exclude the known sub-paths, then take the
  // most recent remaining response (the bare conversation endpoint).
  const convUrl = `/backend-api/conversation/${conversationId}`;
  const convResp = await view.wbCdpFindResponse({ urlSubstring: convUrl, mode: 'all' });
  if (!convResp.success) {
    warnings.push('CDP not running — start "📡 CDP 抓包" and reload the page.');
    return out;
  }
  const bareConvMatches = (convResp.matches || []).filter(m => {
    const tail = m.url.split(conversationId)[1] || '';
    // Empty or query-string-only tail = bare conversation endpoint
    return tail === '' || tail.startsWith('?');
  });
  const convMatch = bareConvMatches[bareConvMatches.length - 1];
  if (!convMatch || !convMatch.body) {
    warnings.push(`Conversation response not in CDP cache for ${conversationId}. Reload the page after starting CDP.`);
  } else {
    try {
      const conv = JSON.parse(convMatch.body);
      out.title = conv.title || '';
      const ordered = walkMapping(conv.mapping || {});
      out.messages = ordered.map(normalizeMessage).filter(m => !m.hidden || m.fileRefs.length > 0);
    } catch (err) {
      warnings.push('Failed to parse conversation JSON: ' + String(err));
    }
  }

  // ── Textdocs (Canvas) ─────────────────────────────────────
  const tdUrl = `/backend-api/conversation/${conversationId}/textdocs`;
  const tdResp = await view.wbCdpFindResponse({ urlSubstring: tdUrl, mode: 'latest' });
  const tdMatch = (tdResp.matches || [])[0];
  if (tdMatch && tdMatch.body) {
    try {
      const arr = JSON.parse(tdMatch.body);
      if (Array.isArray(arr)) {
        out.textdocs = arr.map((d: any) => ({
          id: d.id,
          version: d.version ?? 0,
          title: d.title || '',
          textdocType: d.textdoc_type || 'document',
          content: d.content || '',
        }));
      }
    } catch (err) {
      warnings.push('Failed to parse textdocs JSON: ' + String(err));
    }
  }
  // Missing textdocs is normal (no Canvas used in the conversation).

  // ── Files referenced by messages ──────────────────────────
  const referenced = new Set<string>();
  for (const m of out.messages) for (const id of m.fileRefs) referenced.add(id);

  if (referenced.size > 0) {
    const estuaryResp = await view.wbCdpFindResponse({ urlSubstring: '/backend-api/estuary/content', mode: 'all' });
    const byId = new Map<string, { body: string | null; mimeType: string; len: number }>();
    for (const r of estuaryResp.matches || []) {
      const id = fileIdFromEstuaryUrl(r.url);
      if (!id) continue;
      // Keep the latest response per file id.
      byId.set(id, { body: r.body, mimeType: r.mimeType, len: r.bodyLength });
    }

    for (const fileId of referenced) {
      const hit = byId.get(fileId);
      if (!hit || !hit.body) {
        out.files[fileId] = { fileId, mimeType: '', dataUrl: null, bodyLength: 0 };
        warnings.push(`File ${fileId} referenced but no estuary response in CDP cache.`);
        continue;
      }
      // Estuary serves image bytes with `Content-Type: application/octet-stream`,
      // which breaks `<img src="data:...">` display. Sniff the real MIME type
      // from the base64 body's magic bytes and override.
      const detected = sniffMimeFromBase64(hit.body) || hit.mimeType || 'application/octet-stream';
      out.files[fileId] = {
        fileId,
        mimeType: detected,
        dataUrl: `data:${detected};base64,${hit.body}`,
        bodyLength: hit.len,
      };
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
// Debug / manual test hook
// ─────────────────────────────────────────────────────────────

/**
 * Extract the current page's content and log a compact summary to the
 * console. Returns the raw ChatGPTContent for further inspection.
 *
 * Intended for the 🧪 ChatGPT button in AIWebView.
 */
export async function debugExtractContent(
  webview: Electron.WebviewTag,
  view: ViewAPILike,
): Promise<ChatGPTContent> {
  const c = await extractContent(webview, view);
  // eslint-disable-next-line no-console
  console.log('[ChatGPTExtract] convId:', c.conversationId, 'title:', c.title);
  // eslint-disable-next-line no-console
  console.log('[ChatGPTExtract] messages:', c.messages.length, c.messages.map(m => ({
    role: m.role, recipient: m.recipient, textLen: m.text.length, codes: m.codeBlocks.length, files: m.fileRefs,
  })));
  // eslint-disable-next-line no-console
  console.log('[ChatGPTExtract] textdocs:', c.textdocs.length, c.textdocs.map(d => ({
    id: d.id, ver: d.version, title: d.title, len: d.content.length,
  })));
  const fileSummary = Object.values(c.files).map(f => ({ id: f.fileId, mime: f.mimeType, len: f.bodyLength, hasDataUrl: !!f.dataUrl }));
  // eslint-disable-next-line no-console
  console.log('[ChatGPTExtract] files:', fileSummary);
  if (c.warnings.length) {
    // eslint-disable-next-line no-console
    console.warn('[ChatGPTExtract] warnings:', c.warnings);
  }
  return c;
}
