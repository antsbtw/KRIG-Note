/**
 * Gemini Conversation Query — structured access to Gemini conversation data
 * for extraction into Note.
 *
 * Reads from trace-writer's cached conversation.json (kind: 'gemini-conversation')
 * which contains the raw batchexecute response body captured via fetch interceptor.
 *
 * Zero DOM/CDP — all data comes from the batchexecute API response.
 *
 * Gemini's unique properties:
 *   - API returns complete Markdown (no contentParts reassembly needed)
 *   - Response is a multi-frame stream with positional arrays (no field names)
 *   - Turns are newest-first (reversed to chronological order)
 *   - Imagen images require main-process net.fetch (CORS restriction)
 */

import { browserCapabilityTraceWriter } from '../persistence';

// ── Public types ──

export type GeminiConversationData = {
  conversationId: string | null;
  turns: GeminiTurn[];
};

export type GeminiTurn = {
  index: number;
  conversationId: string;
  responseId: string;
  userMessage: string;
  /** Complete assistant Markdown — ready to render, no reassembly needed. */
  markdown: string;
  /** Thinking chain text (separate from markdown). */
  thinking: string | null;
  /** Imagen image URLs (lh3.googleusercontent.com, short-lived). */
  imageUrls: string[];
  /** Web-search grounding entries. */
  groundings: GeminiGrounding[];
  createdAt: number;
};

export type GeminiGrounding = {
  title: string;
  url: string;
};

// ── Helpers ──

/** Safely index into a nested array by path. */
function getPath(obj: any, path: number[]): any {
  let cur = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Parse a batchexecute response body into an array of frames.
 *
 * Format: )]}'  prefix + length-delimited JSON frames.
 * We ignore the declared byte length (UTF-8 vs UTF-16 mismatch)
 * and greedy-parse to the next frame boundary.
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

/** Pick the inner payload of a specific rpcId from parsed frames. */
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

/** Collect Imagen image URLs from turn[3][0][0][12][7][0][0][0]. */
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

/** Collect web-search groundings from turn[3][12][0][0][14][12]. */
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

/** Normalize a single raw turn from the hNvQHb array. */
function normalizeTurn(raw: any, index: number): GeminiTurn | null {
  const convId = getPath(raw, [0, 0]);
  const respId = getPath(raw, [0, 1]);
  const userText = getPath(raw, [2, 0, 0]);
  const assistant = getPath(raw, [3]);
  const markdown = getPath(assistant, [0, 0, 1, 0]) || '';
  const thinking = getPath(assistant, [0, 0, 37, 0, 0]) || null;
  const tsSec = getPath(raw, [4, 0]);

  if (typeof convId !== 'string' || typeof respId !== 'string') return null;

  return {
    index,
    conversationId: convId,
    responseId: respId,
    userMessage: typeof userText === 'string' ? userText : '',
    markdown: typeof markdown === 'string' ? markdown : '',
    thinking: typeof thinking === 'string' ? thinking : null,
    imageUrls: collectImageUrls(assistant),
    groundings: collectGroundings(assistant),
    createdAt: typeof tsSec === 'number' ? tsSec : 0,
  };
}

// ── Main API ──

/**
 * Get structured Gemini conversation data from the trace-writer cache.
 * Returns null if no Gemini conversation data is available for the page.
 */
export function getGeminiConversationData(pageId: string): GeminiConversationData | null {
  const raw = browserCapabilityTraceWriter.readExtractedJson(pageId, 'conversation.json');
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  if (record.kind !== 'gemini-conversation') return null;

  const body = record.body;
  if (typeof body !== 'string' || body.length < 100) return null;

  // Parse batchexecute multi-frame response
  const frames = parseBatchExecute(body);
  if (frames.length === 0) return null;

  const inner = pickRpcInner(frames, 'hNvQHb');
  if (!Array.isArray(inner) || !Array.isArray(inner[0])) return null;

  // Extract conversation ID from URL
  const url = typeof record.url === 'string' ? record.url : '';
  const convMatch = url.match(/\/app\/([a-f0-9]+)/);
  const conversationId = convMatch ? convMatch[1] : null;

  // Normalize turns (newest first → reverse to chronological)
  const turnsRaw = inner[0];
  const turns: GeminiTurn[] = [];
  for (const raw of turnsRaw) {
    const t = normalizeTurn(raw, 0); // index will be reassigned after reverse
    if (t) turns.push(t);
  }
  turns.reverse();

  // Reassign indices after reversal
  for (let i = 0; i < turns.length; i++) {
    turns[i].index = i;
  }

  return { conversationId, turns };
}
