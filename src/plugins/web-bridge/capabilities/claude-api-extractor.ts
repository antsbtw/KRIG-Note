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
 * Extract Artifact HTML content by clicking the "Copy to clipboard" button.
 * Reads the system clipboard via main process (renderer clipboard is blocked by focus).
 *
 * Strategy:
 *   1. Find buttons with aria-label="copy to clipboard" in page DOM
 *   2. Click the Nth button (0-indexed)
 *   3. Wait briefly for clipboard write
 *   4. Read clipboard from main process
 *
 * @param webview - guest webview
 * @param index - which artifact copy button to click (0 = first, -1 = last)
 * @param readClipboard - function to read clipboard (main process IPC)
 */
export async function extractArtifactContent(
  webview: Electron.WebviewTag,
  index: number,
  readClipboard: () => Promise<string>,
): Promise<string | null> {
  try {
    // Find Artifact Copy button (aria-label="Copy", but NOT data-testid="action-bar-copy"
    // which is the per-message copy button). Artifact toolbar has Retry/Edit/Copy/Close fullscreen.
    const clicked = await webview.executeJavaScript(`(function() {
      var all = document.querySelectorAll('button');
      var btns = [];
      for (var i = 0; i < all.length; i++) {
        var label = (all[i].getAttribute('aria-label') || '').toLowerCase();
        var testid = all[i].getAttribute('data-testid') || '';
        // Artifact Copy: label is "Copy" exactly (not "copy to clipboard"),
        // and NOT the message copy (which has testid="action-bar-copy")
        if (label === 'copy' && testid !== 'action-bar-copy') {
          btns.push(all[i]);
        }
      }
      if (btns.length === 0) return { success: false, total: 0 };
      var target = ${index >= 0 ? `btns[${index}]` : 'btns[btns.length - 1]'};
      if (!target) return { success: false, total: btns.length, requested: ${index} };
      target.click();
      return { success: true, total: btns.length, clicked: ${index} };
    })()`);

    if (!clicked?.success) {
      console.warn('[ClaudeAPI] No artifact copy button found. Total:', clicked?.total, 'Requested index:', clicked?.requested);
      // Debug: dump all button aria-labels so we can see what's available
      const btnInfo = await webview.executeJavaScript(`(function() {
        var all = document.querySelectorAll('button');
        var labels = [];
        for (var i = 0; i < all.length; i++) {
          var l = all[i].getAttribute('aria-label');
          if (l) labels.push(l);
        }
        return { totalButtons: all.length, withAriaLabel: labels.length, labels: labels };
      })()`);
      console.warn('[ClaudeAPI] Page has', btnInfo.totalButtons, 'buttons,', btnInfo.withAriaLabel, 'with aria-label.');
      console.warn('[ClaudeAPI] All labels:\n  - ' + btnInfo.labels.join('\n  - '));
      return null;
    }

    // Wait for clipboard to be written
    await new Promise(r => setTimeout(r, 300));

    const text = await readClipboard();
    if (!text || !text.trim()) return null;
    return text.trim();
  } catch (err) {
    console.error('[ClaudeAPI] Artifact extraction failed:', err);
    return null;
  }
}

/**
 * For an assistant message containing N artifact placeholders,
 * extract all N artifact contents and replace placeholders in the text.
 *
 * @param messageText - raw message text with placeholders
 * @param artifactStartIndex - index of the first artifact button on the page that corresponds to this message's first placeholder
 * @param webview - guest webview
 * @param readClipboard - clipboard reader
 */
export async function replaceArtifactPlaceholders(
  messageText: string,
  artifactStartIndex: number,
  webview: Electron.WebviewTag,
  readClipboard: () => Promise<string>,
): Promise<string> {
  const placeholderRegex = /(```[^\n]*\n)(?:[^\n]*\n)*?This block is not supported on your current device yet\.(?:[^\n]*\n)*?(```)/g;
  const parts: string[] = [];
  let lastIdx = 0;
  let artifactIdx = artifactStartIndex;
  let match: RegExpExecArray | null;

  while ((match = placeholderRegex.exec(messageText)) !== null) {
    // Text before placeholder
    if (match.index > lastIdx) {
      parts.push(messageText.slice(lastIdx, match.index));
    }

    // Extract actual artifact content
    const content = await extractArtifactContent(webview, artifactIdx, readClipboard);
    if (content) {
      // Detect content type and wrap as appropriate code block
      const isHtml = /<html|<!doctype|<svg|<style|<script/i.test(content.slice(0, 500));
      const lang = isHtml ? 'html' : '';
      parts.push('```' + lang + '\n' + content + '\n```');
    } else {
      // Fallback: keep original placeholder
      parts.push(match[0]);
    }

    lastIdx = match.index + match[0].length;
    artifactIdx++;
  }

  // Remaining text
  if (lastIdx < messageText.length) {
    parts.push(messageText.slice(lastIdx));
  }

  return parts.length > 0 ? parts.join('') : messageText;
}
