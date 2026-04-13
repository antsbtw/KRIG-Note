/**
 * Claude Conversation API Extractor
 *
 * 绕过 SSE 和 DOM，直接调用 Claude 的 conversation API 获取完整对话数据。
 * 这是 Claude 服务器返回的权威数据源，包含所有消息的原始 Markdown。
 *
 * API endpoints (发现于 CDP 抓包)：
 *   GET /api/organizations/{org_id}/chat_conversations/{conv_id}
 *     返回：{ uuid, chat_messages: [{ uuid, content: [{ type, text, ... }], sender, ... }], ... }
 *
 *   GET /api/organizations/{org_id}/artifacts/{conv_id}/
 *     返回：{ artifact_versions: [...] }
 *
 * 优势：
 * - 原始 Markdown，格式 100% 准确（SSE text_delta 相同的来源）
 * - 包含所有消息（不只是最后一条）
 * - 包含所有 Artifact 元数据（SVG、代码、图表）
 * - 任何时候可调用（不需要等 SSE 流或渲染 DOM）
 *
 * Design doc: docs/web/WebBridge-设计.md §五 读取能力
 */

export interface ClaudeMessage {
  uuid: string;
  sender: 'human' | 'assistant';
  index: number;
  text: string;  // Raw Markdown
  created_at: string;
  attachments?: any[];
  files?: any[];
}

export interface ClaudeConversation {
  uuid: string;
  name: string;
  model: string;
  messages: ClaudeMessage[];
  raw?: any; // Original API response
}

export interface ClaudeArtifactVersion {
  id?: string;
  type?: string;
  title?: string;
  content?: string;
  language?: string;
  raw?: any;
}

/**
 * Extract conversation_id from Claude page URL.
 * URL format: https://claude.ai/chat/{conversation_id}
 */
export function extractConversationId(url: string): string | null {
  const match = url.match(/\/chat\/([a-f0-9-]{36})/);
  return match ? match[1] : null;
}

/**
 * Extract full conversation data by calling Claude's internal API.
 * Runs in the guest webview context (has auth cookies).
 *
 * @param webview - Electron WebviewTag
 * @returns Parsed conversation or null if extraction fails
 */
export async function extractClaudeConversation(
  webview: Electron.WebviewTag,
): Promise<ClaudeConversation | null> {
  const url = webview.getURL?.() || '';
  const convId = extractConversationId(url);
  if (!convId) {
    console.warn('[ClaudeAPI] Not on a Claude chat page:', url);
    return null;
  }

  try {
    // Execute fetch inside guest page — has login cookies
    const script = `(async function() {
      var convId = ${JSON.stringify(convId)};

      // Step 1: Get organization ID from bootstrap API
      var orgsResp = await fetch('/api/organizations/', { credentials: 'include' });
      if (!orgsResp.ok) return { error: 'Failed to get organizations: ' + orgsResp.status };
      var orgs = await orgsResp.json();
      if (!Array.isArray(orgs) || orgs.length === 0) return { error: 'No organizations found' };
      var orgId = orgs[0].uuid;

      // Step 2: Fetch conversation
      var convResp = await fetch('/api/organizations/' + orgId + '/chat_conversations/' + convId, {
        credentials: 'include',
      });
      if (!convResp.ok) return { error: 'Failed to get conversation: ' + convResp.status };
      var conv = await convResp.json();

      // Note: Artifact endpoint consistently returns 404.
      // Artifact content is NOT available via server API — it must be
      // extracted via the "Copy to clipboard" button in the page UI.
      return { conv: conv, orgId: orgId };
    })()`;

    const result = await webview.executeJavaScript(script);

    if (!result || result.error) {
      console.warn('[ClaudeAPI] Extraction failed:', result?.error);
      return null;
    }

    const raw = result.conv;
    // Claude's chat_messages use the top-level `text` field as the authoritative source.
    // The `content` array exists but is always empty in observed responses.
    const messages: ClaudeMessage[] = (raw.chat_messages || []).map((m: any) => ({
      uuid: m.uuid,
      sender: m.sender,
      index: m.index,
      text: m.text || '',
      created_at: m.created_at,
      attachments: m.attachments,
      files: m.files,
    }));

    console.log(`[ClaudeAPI] Extracted ${messages.length} messages from conversation ${convId}`);

    return {
      uuid: raw.uuid,
      name: raw.name || '',
      model: raw.model || '',
      messages,
      raw: { conversation: raw },
    };
  } catch (err) {
    console.error('[ClaudeAPI] Exception:', err);
    return null;
  }
}

/**
 * Extract only the last assistant message (latest response).
 * Convenience wrapper for sync use case.
 */
export async function extractLatestClaudeResponse(
  webview: Electron.WebviewTag,
): Promise<{ userMessage: string; assistantMessage: string; raw: ClaudeConversation | null } | null> {
  const conv = await extractClaudeConversation(webview);
  if (!conv || conv.messages.length === 0) return null;

  // Find last assistant message + its preceding human message
  let lastAssistantIdx = -1;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].sender === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) return null;

  let userMessage = '';
  for (let i = lastAssistantIdx - 1; i >= 0; i--) {
    if (conv.messages[i].sender === 'human') {
      userMessage = conv.messages[i].text;
      break;
    }
  }

  return {
    userMessage,
    assistantMessage: conv.messages[lastAssistantIdx].text,
    raw: conv,
  };
}

/**
 * Check if current URL is a Claude conversation page.
 */
export function isClaudeConversationPage(url: string): boolean {
  return /^https:\/\/claude\.ai\/chat\/[a-f0-9-]+/.test(url);
}

/** Placeholder string Claude inserts for Artifact content when rendered for non-official clients. */
export const CLAUDE_ARTIFACT_PLACEHOLDER = 'This block is not supported on your current device yet.';

/**
 * Count how many artifact placeholders appear in a message text.
 * Each `\`\`\`\nThis block is not supported...\n\`\`\`` corresponds to one Artifact.
 */
export function countArtifactPlaceholders(text: string): number {
  if (!text) return 0;
  const matches = text.match(/```[\s\S]*?This block is not supported on your current device yet\.[\s\S]*?```/g);
  return matches?.length ?? 0;
}


/**
 * Fetch Claude's artifact versions endpoint for a conversation.
 *
 * Observed URL: `/api/organizations/{org}/artifacts/{conv}/versions?source=w`
 * Response shape: `{ artifact_versions: [{ id?, type?, title?, content?, ... }, ...] }`
 *
 * The array is empty during/right after streaming — the caller should poll
 * until it's populated (or give up after a timeout).
 */
export async function fetchClaudeArtifactVersions(
  webview: Electron.WebviewTag,
): Promise<any[] | null> {
  const url = webview.getURL?.() || '';
  const convId = extractConversationId(url);
  if (!convId) return null;

  try {
    const script = `(async function() {
      var orgsResp = await fetch('/api/organizations/', { credentials: 'include' });
      if (!orgsResp.ok) return { error: 'orgs ' + orgsResp.status };
      var orgs = await orgsResp.json();
      if (!Array.isArray(orgs) || orgs.length === 0) return { error: 'no orgs' };
      var orgId = orgs[0].uuid;
      var convId = ${JSON.stringify(convId)};

      // Try both URL shapes — Claude has used both over time.
      var urls = [
        '/api/organizations/' + orgId + '/artifacts/' + convId + '/versions?source=w',
        '/api/organizations/' + orgId + '/artifacts/' + convId + '/versions',
        '/api/organizations/' + orgId + '/artifacts/' + convId,
      ];
      for (var i = 0; i < urls.length; i++) {
        try {
          var r = await fetch(urls[i], { credentials: 'include' });
          if (!r.ok) continue;
          var j = await r.json();
          var vers = j && (j.artifact_versions || j.versions || j);
          if (Array.isArray(vers) && vers.length > 0) return { versions: vers, url: urls[i] };
          if (Array.isArray(vers)) return { versions: [], url: urls[i] }; // empty but valid
        } catch (e) {}
      }
      return { versions: [], url: null };
    })()`;
    const result = await webview.executeJavaScript(script);
    if (!result || result.error) return null;
    return Array.isArray(result.versions) ? result.versions : null;
  } catch {
    return null;
  }
}

/**
 * Extract the source text from a Claude artifact version object. The shape
 * varies (code artifact vs. HTML vs. React), but typically there's a
 * `content`, `source`, or `code` string somewhere.
 */
export function extractArtifactVersionSource(version: any): string | null {
  if (!version || typeof version !== 'object') return null;
  const candidates = [
    version.content,
    version.source,
    version.code,
    version.html,
    version.body,
    version.markup,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  // Nested under `artifact` or `data`
  if (version.artifact) {
    const nested = extractArtifactVersionSource(version.artifact);
    if (nested) return nested;
  }
  if (version.data) {
    const nested = extractArtifactVersionSource(version.data);
    if (nested) return nested;
  }
  return null;
}

/**
 * Raw captured postMessage record from the claude.ai → artifact iframe
 * data stream. Shape is whatever Anthropic's code posts; we only look at
 * fields we can recognize.
 */
export interface CapturedArtifactMessage {
  ts: number;
  channel?: 'window' | 'port';
  direction: 'in' | 'out';
  targetOrigin: string | null;
  sourceOrigin: string | null;
  data: any;
}

/**
 * Read all artifact-related postMessage payloads captured by the
 * artifact-postmessage-hook injected into the claude.ai page.
 *
 * Returns an empty array if the hook isn't installed or nothing was
 * captured yet.
 */
export async function readCapturedArtifactMessages(
  webview: Electron.WebviewTag,
): Promise<CapturedArtifactMessage[]> {
  try {
    const result = await webview.executeJavaScript(
      `(function() { return window.__krig_artifact_messages || []; })()`,
    );
    return Array.isArray(result) ? (result as CapturedArtifactMessage[]) : [];
  } catch {
    return [];
  }
}

/**
 * Best-effort extraction of artifact source code from a captured postMessage
 * payload. Claude's internal message shape is undocumented, so we walk the
 * object looking for plausible source-code-bearing string fields.
 *
 * Strategy: depth-first scan for string values under keys commonly used for
 * code (`source`, `code`, `content`, `html`, `artifact`, `files`...). We
 * prefer the longest plausible string in the payload as the artifact body.
 */
export function extractArtifactSourceFromPayload(payload: any): string | null {
  if (payload == null) return null;

  const SOURCE_KEYS = new Set([
    'source', 'sourceCode', 'code', 'content', 'body', 'contents',
    'html', 'svg', 'markup', 'text', 'artifact', 'files', 'file',
    'template', 'script',
  ]);

  // Ignore JSON-RPC notifications we know don't carry source.
  const NOISE_METHODS = new Set([
    'ui/notifications/sandbox-proxy-ready',
    'ui/notifications/initialized',
    'ui/notifications/size-changed',
    'notifications/message',
    'ui/initialize', // request, not response
  ]);
  if (payload && typeof payload === 'object' && typeof payload.method === 'string' && NOISE_METHODS.has(payload.method)) {
    return null;
  }

  let best: string | null = null;

  const consider = (s: string) => {
    if (typeof s !== 'string' || s.length < 40) return;
    if (!best || s.length > best.length) best = s;
  };

  const visit = (node: any, keyHint?: string) => {
    if (node == null) return;
    if (typeof node === 'string') {
      const looksLikeCode = /<\w|<\/|\bfunction\b|\bimport\b|\bconst\b|\breturn\b|\bclass\b|```|\{[\s\S]*\}/.test(node);
      const underKnownKey = keyHint ? SOURCE_KEYS.has(keyHint) : false;
      if (underKnownKey || looksLikeCode) consider(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, keyHint);
      return;
    }
    if (typeof node === 'object') {
      // MCP resources/read shape: { contents: [{ uri, mimeType, text }] }
      if (Array.isArray((node as any).contents)) {
        for (const c of (node as any).contents) {
          if (c && typeof c.text === 'string') consider(c.text);
          if (c && typeof c.blob === 'string') consider(c.blob);
        }
      }
      // Our fetch-hook shape: { url, body }
      if (typeof (node as any).url === 'string' && (node as any).body != null) {
        visit((node as any).body, 'body');
        return;
      }
      for (const k of Object.keys(node)) visit(node[k], k);
    }
  };

  visit(payload);
  return best;
}

/**
 * From a list of captured messages, pick the most recent artifact source
 * strings (deduplicated). Returns an ordered list, newest first.
 */
export function collectArtifactSources(
  messages: CapturedArtifactMessage[],
): string[] {
  const seen = new Set<string>();
  const sources: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const src = extractArtifactSourceFromPayload(messages[i].data);
    if (src && !seen.has(src)) {
      seen.add(src);
      sources.push(src);
    }
  }
  return sources;
}

/**
 * Detect the fenced code-block language hint (e.g. ```tsx, ```html) from
 * an artifact placeholder segment, so we can preserve the info line when
 * substituting real source in.
 */
function extractPlaceholderInfoString(placeholderBlock: string): string {
  const m = placeholderBlock.match(/^```([^\n]*)/);
  return m ? m[1].trim() : '';
}

/**
 * Replace Claude Artifact placeholders in `messageText` with captured
 * artifact source code (from postMessage hook). Placeholders are matched in
 * document order and replaced with sources in the order they were captured
 * (newest first — so the Nth placeholder from the end of the message maps
 * to the Nth captured artifact).
 *
 * Returns the (possibly) rewritten text and a count of how many
 * placeholders were successfully filled.
 */
export function fillArtifactPlaceholders(
  messageText: string,
  capturedSources: string[],
): { text: string; filled: number; remaining: number } {
  if (!messageText || capturedSources.length === 0) {
    const remaining = countArtifactPlaceholders(messageText || '');
    return { text: messageText, filled: 0, remaining };
  }

  const placeholderRegex = /```[^\n]*\n(?:[^\n]*\n)*?This block is not supported on your current device yet\.(?:[^\n]*\n)*?```/g;
  const placeholders = messageText.match(placeholderRegex) || [];
  // Map i-th placeholder (from end) to i-th captured source (newest first),
  // which matches the user's most-recent-visible-first mental model.
  const placeholdersFromEnd = placeholders.length;
  let filled = 0;
  let idxFromStart = 0;

  const result = messageText.replace(placeholderRegex, (block) => {
    const idxFromEnd = placeholdersFromEnd - 1 - idxFromStart;
    idxFromStart += 1;
    const src = capturedSources[idxFromEnd];
    if (!src) return block;
    filled += 1;
    const info = extractPlaceholderInfoString(block) || 'html';
    return '```' + info + '\n' + src + '\n```';
  });

  return { text: result, filled, remaining: placeholdersFromEnd - filled };
}

/**
 * Replace Claude Artifact placeholders with user-friendly callouts.
 *
 * Investigation conclusion (2026-04-13):
 *   - Claude server returns "This block is not supported..." placeholder in
 *     conversation API for any non-official client (regardless of headers/UA)
 *   - Real Artifact content is rendered in cross-origin iframe (claudemcpcontent.com)
 *     that we cannot access (CORS, sandboxed)
 *   - The placeholder string contains NO artifact ID/UUID — there's no way
 *     to look up the real content from API
 *
 * Best we can do: replace the cryptic placeholder with a friendly callout
 * pointing the user back to the Claude page where they can see the Artifact.
 */
export function replaceArtifactPlaceholders(
  messageText: string,
  conversationUrl?: string,
): string {
  const placeholderRegex = /```[^\n]*\n(?:[^\n]*\n)*?This block is not supported on your current device yet\.(?:[^\n]*\n)*?```/g;
  const linkText = conversationUrl
    ? `> [在 Claude 中查看](${conversationUrl})`
    : `> 请在原始 Claude 对话中查看`;
  return messageText.replace(
    placeholderRegex,
    `> [!note] Claude Artifact (交互式内容)\n> 这里是 Claude 生成的交互式 HTML/图表，无法自动提取到 Note。\n${linkText}`,
  );
}
