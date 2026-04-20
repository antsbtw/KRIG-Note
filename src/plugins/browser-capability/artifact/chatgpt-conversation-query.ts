/**
 * ChatGPT Conversation Query — structured access to ChatGPT conversation data
 * for extraction into Note.
 *
 * Reads from trace-writer's cached conversation.json (kind: 'chatgpt-conversation')
 * and provides a unified interface for extract-turn to consume.
 *
 * ChatGPT conversation structure:
 *   - `mapping`: tree of nodes, each with `parent`, `children[]`, `message`
 *   - Walk last-child at each node for display order
 *   - Messages have `author.role`, `content.parts[]`, `metadata`
 *   - Artifacts: DALL·E images (asset_pointer), Code Interpreter (aggregate_result),
 *     Canvas (textdocs), user uploads (attachments)
 */

import { browserCapabilityTraceWriter } from '../persistence';

// ── Public types ──

export type ChatGPTConversationData = {
  conversationId: string;
  title: string;
  model?: string;
  turns: ChatGPTTurn[];
};

export type ChatGPTTurn = {
  index: number;
  userMessage: string;
  assistantMessages: ChatGPTAssistantMessage[];
  /** All file IDs referenced in this turn (DALL·E, Code Interpreter, attachments). */
  fileRefs: string[];
};

export type ChatGPTAssistantMessage = {
  id: string;
  text: string;
  codeBlocks: Array<{ language: string; code: string }>;
  fileRefs: string[];
  recipient: string | null;
  createdAt: number | null;
};

export type ChatGPTTextdoc = {
  id: string;
  version: number;
  title: string;
  textdocType: string;
  content: string;
};

// ── Helpers ──

/**
 * Walk ChatGPT's conversation mapping tree (parent→children graph),
 * following the last child at each node. Returns messages in display order.
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

/**
 * Extract file_XXX id from any ChatGPT pointer:
 *   file-service://file_XXX
 *   sediment://file_XXX
 *   file_XXX (direct)
 */
function fileIdFromPointer(ptr: string | undefined | null): string | null {
  if (!ptr || typeof ptr !== 'string') return null;
  const m = ptr.match(/file_[A-Za-z0-9]+/);
  return m ? m[0] : null;
}

/**
 * Strip ChatGPT's U+E200..U+E201 widget directives from text.
 *
 * Format: U+E200 <type> U+E202 <json> U+E201
 * Known types:
 *   - image_group: search image grid (query-based, not downloadable)
 *
 * For image_group: remove entirely (search result images can't be reproduced).
 * For unknown types: remove the widget markers, keep as-is for debugging.
 */
function stripUnicodeWidgets(text: string): string {
  if (!text) return text;
  // Match: \uE200 <word> \uE202 <json-until-\uE201> \uE201
  return text.replace(
    /\uE200(\w+)\uE202([\s\S]*?)\uE201/g,
    (_match, widgetType, jsonBody) => {
      if (widgetType === 'image_group') {
        // Search result images — remove entirely
        return '';
      }
      // Math widgets (genui, genua, genub, etc.) — extract LaTeX content
      if (widgetType.startsWith('genu')) {
        try {
          const obj = JSON.parse(jsonBody);
          for (const key of Object.keys(obj)) {
            const payload = obj[key];
            if (payload && typeof payload === 'object') {
              const latex = typeof payload.content === 'string' ? payload.content
                : typeof payload.latex === 'string' ? payload.latex
                : null;
              if (latex && /math|latex/i.test(key)) {
                return '\n\n$$' + latex.trim() + '$$\n\n';
              }
            }
          }
        } catch {}
      }
      // Unknown widget — remove entirely
      return '';
    },
  );
}

/**
 * Unwrap ChatGPT's private "widget" directives (math_block_widget etc.)
 * into standard LaTeX notation.
 */
function unwrapWidgets(text: string): string {
  if (!text) return text;
  const GENU = 'genu';
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const found = text.indexOf(GENU, i);
    if (found < 0) { out.push(text.slice(i)); break; }
    let brace = -1;
    for (let k = found + GENU.length; k < Math.min(found + GENU.length + 4, text.length); k++) {
      if (text[k] === '{') { brace = k; break; }
    }
    if (brace < 0) {
      out.push(text.slice(i, found + GENU.length));
      i = found + GENU.length;
      continue;
    }
    let depth = 0;
    let j = brace;
    let inStr = false;
    let esc = false;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = false; continue; }
      } else {
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { j++; break; }
        }
      }
    }
    if (depth !== 0) { out.push(text.slice(i)); break; }
    const body = text.slice(brace, j);
    let start = found;
    if (start > 0) {
      const prev = text.charCodeAt(start - 1);
      if (prev >= 0xE000 && prev <= 0xF8FF) start = start - 1;
    }
    let end = j;
    if (end < text.length) {
      const next = text.charCodeAt(end);
      if (next >= 0xE000 && next <= 0xF8FF) end = end + 1;
    }
    out.push(text.slice(i, start));
    let replaced: string | null = null;
    try {
      const obj = JSON.parse(body);
      for (const key of Object.keys(obj)) {
        const payload = obj[key];
        if (payload && typeof payload === 'object') {
          const latex = typeof payload.content === 'string' ? payload.content
            : typeof payload.latex === 'string' ? payload.latex
            : null;
          if (latex && /math|latex/i.test(key)) {
            replaced = '\n\n$$' + latex.trim() + '$$\n\n';
            break;
          }
        }
      }
    } catch {}
    out.push(replaced ?? text.slice(start, end));
    i = end;
  }
  return out.join('');
}

/** Parse fenced code blocks from Markdown. */
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
 * Extract text and file refs from a single ChatGPT message.
 */
function extractMessageContent(raw: any): {
  text: string;
  fileRefs: string[];
  recipient: string | null;
  hidden: boolean;
} {
  const parts = raw.content?.parts || [];
  const textParts: string[] = [];
  const fileRefs: string[] = [];

  for (const p of parts) {
    if (typeof p === 'string') {
      if (p.length > 0) textParts.push(p);
    } else if (p && typeof p === 'object') {
      if (p.asset_pointer) {
        const id = fileIdFromPointer(p.asset_pointer);
        if (id) fileRefs.push(id);
      }
    }
  }

  // User uploads (attachments)
  const attachments = raw.metadata?.attachments;
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (a?.id && /^file_/.test(a.id)) fileRefs.push(a.id);
    }
  }

  // Code Interpreter images: metadata.aggregate_result.messages[].image_url
  const agg = raw.metadata?.aggregate_result;
  if (agg && Array.isArray(agg.messages)) {
    for (const m of agg.messages) {
      if (typeof m?.image_url === 'string') {
        const id = fileIdFromPointer(m.image_url);
        if (id) fileRefs.push(id);
      }
    }
  }

  const text = stripUnicodeWidgets(unwrapWidgets(textParts.join('\n\n')));
  const hidden = !!raw.metadata?.is_visually_hidden_from_conversation;
  const recipient: string | null = raw.recipient ?? null;

  return { text, fileRefs: Array.from(new Set(fileRefs)), recipient, hidden };
}

// ── Main API ──

/**
 * ChatGPT DOM uses `[data-message-author-role="assistant"]` to mark each
 * visible assistant "bubble". These map 1:1 to assistant messages that are
 * NOT hidden and have `content_type` in a visible set (primarily 'text').
 *
 * The DOM's msgIndex counts these visible assistant bubbles from 0.
 * We must produce turns that align with this indexing so that right-click
 * extraction picks the correct content.
 *
 * Strategy: each visible assistant message = one turn. We look backward to
 * find the preceding user message, and forward/backward to collect file refs
 * from adjacent tool messages.
 */

/**
 * content_type values that ChatGPT renders as DOM elements with
 * `[data-message-author-role="assistant"]`.
 *
 * NOT included:
 *   - 'thoughts': rendered as "Thought for Xs" collapsible block, but does
 *     NOT carry the data-message-author-role="assistant" attribute in DOM.
 *   - 'model_editable_context': internal memory, not rendered.
 *   - 'reasoning_recap': not rendered as a standalone bubble.
 *   - 'code': code sent to interpreter, not rendered as assistant bubble.
 */
const VISIBLE_ASSISTANT_CONTENT_TYPES = new Set([
  'text',
  'multimodal_text',
]);

/**
 * Get structured conversation data from the trace-writer cache.
 * Returns null if no ChatGPT conversation data is available for the page.
 */
export function getChatGPTConversationData(pageId: string): ChatGPTConversationData | null {
  const raw = browserCapabilityTraceWriter.getConversationRaw(pageId);
  if (!raw) return null;

  // Verify this is ChatGPT data (has mapping tree)
  const mapping = raw.mapping as Record<string, any> | undefined;
  if (!mapping || typeof mapping !== 'object') return null;

  const conversationId = (raw.conversation_id || raw.id || '') as string;
  const title = (raw.title || '') as string;
  const model = (raw.default_model_slug || '') as string;

  const orderedMessages = walkMapping(mapping);

  // Step 1: Build ordered list of all non-hidden messages with extracted content
  type ParsedMsg = {
    role: string;
    contentType: string;
    text: string;
    fileRefs: string[];
    recipient: string | null;
    hidden: boolean;
    id: string;
    createdAt: number | null;
  };

  const parsed: ParsedMsg[] = [];
  for (const msg of orderedMessages) {
    const role = msg.author?.role || 'unknown';
    const contentType = msg.content?.content_type || 'text';
    const { text, fileRefs, recipient, hidden } = extractMessageContent(msg);
    if (hidden) continue;
    parsed.push({
      role,
      contentType,
      text,
      fileRefs,
      recipient,
      hidden,
      id: msg.id || '',
      createdAt: msg.create_time ?? null,
    });
  }

  // Step 2: Identify visible assistant messages (= DOM bubbles)
  // These are the ones matched by [data-message-author-role="assistant"]
  // that ChatGPT actually renders. Filter to content_type that produces visible output.
  const visibleAssistantIndices: number[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const m = parsed[i];
    if (m.role === 'assistant' && VISIBLE_ASSISTANT_CONTENT_TYPES.has(m.contentType)) {
      visibleAssistantIndices.push(i);
    }
  }

  // Step 3: Build turns — one per visible assistant message
  const turns: ChatGPTTurn[] = [];
  for (let turnIdx = 0; turnIdx < visibleAssistantIndices.length; turnIdx++) {
    const assistantIdx = visibleAssistantIndices[turnIdx];
    const assistantMsg = parsed[assistantIdx];

    // Find preceding user message (skip system/tool/other assistant)
    let userMessage = '';
    for (let j = assistantIdx - 1; j >= 0; j--) {
      if (parsed[j].role === 'user' && parsed[j].text.trim()) {
        userMessage = parsed[j].text;
        break;
      }
    }

    // Collect file refs from this assistant + adjacent tool messages
    const allFileRefs: string[] = [...assistantMsg.fileRefs];

    // Look at tool messages between this assistant and the previous visible assistant
    const prevAssistantIdx = turnIdx > 0 ? visibleAssistantIndices[turnIdx - 1] : -1;
    for (let j = prevAssistantIdx + 1; j < assistantIdx; j++) {
      if (parsed[j].role === 'tool') {
        for (const id of parsed[j].fileRefs) {
          if (!allFileRefs.includes(id)) allFileRefs.push(id);
        }
      }
    }

    // Also check tool messages immediately after this assistant (before next visible assistant)
    const nextAssistantIdx = turnIdx < visibleAssistantIndices.length - 1
      ? visibleAssistantIndices[turnIdx + 1]
      : parsed.length;
    for (let j = assistantIdx + 1; j < nextAssistantIdx; j++) {
      if (parsed[j].role === 'tool') {
        for (const id of parsed[j].fileRefs) {
          if (!allFileRefs.includes(id)) allFileRefs.push(id);
        }
      }
    }

    turns.push({
      index: turnIdx,
      userMessage,
      assistantMessages: [{
        id: assistantMsg.id,
        text: assistantMsg.text,
        codeBlocks: parseCodeBlocks(assistantMsg.text),
        fileRefs: assistantMsg.fileRefs,
        recipient: assistantMsg.recipient,
        createdAt: assistantMsg.createdAt,
      }],
      fileRefs: allFileRefs,
    });
  }

  return { conversationId, title, model, turns };
}

/**
 * Get textdocs (Canvas) data from trace-writer cache.
 */
export function getChatGPTTextdocs(pageId: string): ChatGPTTextdoc[] {
  const payload = browserCapabilityTraceWriter.readExtractedJson(pageId, 'chatgpt-textdocs.json');
  if (!payload || typeof payload !== 'object') return [];
  const content = payload as Record<string, unknown>;
  const data = content.data;
  if (!Array.isArray(data)) return [];
  return data.map((d: any) => ({
    id: d.id || '',
    version: d.version ?? 0,
    title: d.title || '',
    textdocType: d.textdoc_type || 'document',
    content: d.content || '',
  }));
}
