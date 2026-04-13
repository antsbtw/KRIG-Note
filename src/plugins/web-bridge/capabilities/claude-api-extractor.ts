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
