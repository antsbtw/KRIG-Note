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

/** A content part in a turn — text, file reference, or Canvas, in original order. */
export type ChatGPTContentPart =
  | { type: 'text'; text: string; messageId: string }
  | { type: 'file'; fileId: string }
  | { type: 'canvas'; canvas: ChatGPTCanvasData };

export type ChatGPTCanvasData = {
  name: string;
  canvasType: string;   // 'code/react', 'code/python', 'document', etc.
  content: string;
};

export type ChatGPTTurn = {
  index: number;
  userMessage: string;
  /** Content parts in original interleaving order (text, canvas, files). */
  contentParts: ChatGPTContentPart[];
  assistantMessages: ChatGPTAssistantMessage[];
  /** All file IDs referenced in this turn (DALL·E, Code Interpreter, attachments). */
  fileRefs: string[];
  /**
   * Index of this turn's first visible assistant DOM element among all
   * `[data-message-author-role="assistant"]` / `.agent-turn` elements.
   * Used to map right-click DOM msgIndex → turn index.
   */
  domAssistantIndexStart: number;
  /** Number of visible assistant DOM elements in this turn. */
  domAssistantCount: number;
};

export type ChatGPTAssistantMessage = {
  id: string;
  text: string;
  codeBlocks: Array<{ language: string; code: string }>;
  fileRefs: string[];
  recipient: string | null;
  createdAt: number | null;
  /** Expected image count per image_group widget (parsed from widget JSON) */
  imageGroupSizes: number[];
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
  let imageGroupIndex = 0;
  // Match: \uE200 <word> \uE202 <json-until-\uE201> \uE201
  return text.replace(
    /\uE200(\w+)\uE202([\s\S]*?)\uE201/g,
    (_match, widgetType, jsonBody) => {
      if (widgetType === 'image_group') {
        // Each image_group gets a numbered placeholder for correct positioning
        return `\n\n{{IMAGE_GROUP_${imageGroupIndex++}}}\n\n`;
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

/**
 * Parse Canvas data from a canmore.create_textdoc / canmore.update_textdoc message.
 * The message's content.text is JSON: { name, type, content }.
 */
function parseCanvasFromMessage(orderedMessages: any[], msgId: string): ChatGPTCanvasData | null {
  const raw = orderedMessages.find((m: any) => m.id === msgId);
  if (!raw) return null;
  const text = raw.content?.text;
  if (!text || typeof text !== 'string') return null;
  try {
    const obj = JSON.parse(text);
    if (!obj.content || typeof obj.content !== 'string') return null;
    return {
      name: obj.name || '',
      canvasType: obj.type || 'document',
      content: obj.content,
    };
  } catch {
    return null;
  }
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
  imageGroupSizes: number[];
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

  const rawJoined = textParts.join('\n\n');

  // Parse image_group sizes before widget stripping removes the JSON
  const imageGroupSizes: number[] = [];
  const igRegex = /\uE200image_group\uE202([\s\S]*?)\uE201/g;
  let igm: RegExpExecArray | null;
  while ((igm = igRegex.exec(rawJoined)) !== null) {
    try {
      const obj = JSON.parse(igm[1]);
      const queries = obj.query || [];
      const numPer = obj.num_per_query || 1;
      imageGroupSizes.push(queries.length * numPer);
    } catch {
      imageGroupSizes.push(4);
    }
  }

  const text = stripUnicodeWidgets(unwrapWidgets(rawJoined));
  const hidden = !!raw.metadata?.is_visually_hidden_from_conversation;
  const recipient: string | null = raw.recipient ?? null;

  return { text, fileRefs: Array.from(new Set(fileRefs)), recipient, hidden, imageGroupSizes };
}

// ── Main API ──

/**
 * Visible assistant content_type values — these produce user-facing text
 * in ChatGPT's UI. Other types (thoughts, reasoning_recap, code sent to
 * interpreter, model_editable_context) are internal and skipped.
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
    imageGroupSizes: number[];
    endTurn: boolean | null;
  };

  const parsed: ParsedMsg[] = [];
  for (const msg of orderedMessages) {
    const role = msg.author?.role || 'unknown';
    const contentType = msg.content?.content_type || 'text';
    const { text, fileRefs, recipient, hidden, imageGroupSizes } = extractMessageContent(msg);
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
      imageGroupSizes,
      endTurn: msg.end_turn ?? null,
    });
  }

  // Step 2: Group messages into turns.
  //
  // ChatGPT's conversation tree can have multiple assistant messages per
  // user question (e.g. text → Code Interpreter → text → Code Interpreter → text).
  // These form a single "turn" in the UI. The `end_turn=true` field on the
  // final assistant message marks where one complete response ends.
  //
  // Strategy: split on user messages. All non-user messages between two
  // user messages (or after the last user message) belong to one turn.
  // Within each turn, scan all messages to build contentParts in order.

  // Find indices of user messages
  const userIndices: number[] = [];
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].role === 'user') userIndices.push(i);
  }

  const turns: ChatGPTTurn[] = [];
  let domAssistantCursor = 0; // running count of DOM-visible assistant elements
  for (let ui = 0; ui < userIndices.length; ui++) {
    const userIdx = userIndices[ui];
    const userMsg = parsed[userIdx];

    // Range of messages belonging to this turn's response:
    // from after the user message to just before the next user message (or end)
    const rangeStart = userIdx + 1;
    const rangeEnd = ui < userIndices.length - 1 ? userIndices[ui + 1] : parsed.length;

    // Skip turns with no response messages
    if (rangeStart >= rangeEnd) continue;

    // Build contentParts in original order and count DOM-visible elements
    const contentParts: ChatGPTContentPart[] = [];
    const allFileRefs: string[] = [];
    const assistantMessages: ChatGPTAssistantMessage[] = [];
    let domVisibleCount = 0;

    for (let j = rangeStart; j < rangeEnd; j++) {
      const m = parsed[j];

      // Canvas: canmore.create_textdoc / canmore.update_textdoc
      if (m.role === 'assistant' && m.recipient?.startsWith('canmore.') && m.contentType === 'code') {
        const canvas = parseCanvasFromMessage(orderedMessages, m.id);
        if (canvas) {
          contentParts.push({ type: 'canvas', canvas });
        }
        continue;
      }

      // Visible assistant text — also counts as a DOM element
      if (m.role === 'assistant' && VISIBLE_ASSISTANT_CONTENT_TYPES.has(m.contentType)) {
        domVisibleCount++;
        for (const id of m.fileRefs) {
          if (!allFileRefs.includes(id)) allFileRefs.push(id);
        }
        if (m.text.trim()) {
          contentParts.push({ type: 'text', text: m.text, messageId: m.id });
        }
        assistantMessages.push({
          id: m.id,
          text: m.text,
          codeBlocks: parseCodeBlocks(m.text),
          fileRefs: m.fileRefs,
          recipient: m.recipient,
          createdAt: m.createdAt,
          imageGroupSizes: m.imageGroupSizes,
        });
        continue;
      }

      // Tool messages: DALL·E multimodal_text counts as DOM element (.agent-turn)
      if (m.role === 'tool') {
        if (m.contentType === 'multimodal_text') domVisibleCount++;
        for (const id of m.fileRefs) {
          if (!allFileRefs.includes(id)) {
            allFileRefs.push(id);
            contentParts.push({ type: 'file', fileId: id });
          }
        }
        continue;
      }

      // Other (model_editable_context, thoughts, reasoning_recap, code to interpreter): skip
    }

    // Skip turns that produced no visible content
    if (contentParts.length === 0 && assistantMessages.length === 0) continue;

    turns.push({
      index: turns.length,
      userMessage: userMsg.text,
      contentParts,
      assistantMessages,
      fileRefs: allFileRefs,
      domAssistantIndexStart: domAssistantCursor,
      domAssistantCount: domVisibleCount,
    });
    domAssistantCursor += domVisibleCount;
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
