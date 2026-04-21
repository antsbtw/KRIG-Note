/**
 * ChatGPT Extract Turn — converts ChatGPT conversation data into
 * ExtractedTurn format for Note import.
 *
 * Handles: Markdown text, LaTeX, code blocks, DALL·E images,
 * Code Interpreter outputs, Canvas documents, user uploads.
 *
 * Image fetching: uses Bearer token to download from estuary API,
 * converts to data URLs with MIME sniffing.
 */

import { webContents as electronWebContents } from 'electron';
import {
  getChatGPTConversationData,
  type ChatGPTTurn,
  type ChatGPTCanvasData,
} from './chatgpt-conversation-query';
import { browserCapabilityTraceWriter } from '../persistence';
import type { ExtractedTurn, ExtractedConversation } from './extract-turn';

// Media store integration — persists files and returns media:// URLs
let mediaPutBase64: ((input: string, mimeType?: string, filename?: string) =>
  Promise<{ success: boolean; mediaUrl?: string; mediaId?: string }>) | null = null;

async function ensureMediaStore(): Promise<typeof mediaPutBase64> {
  if (mediaPutBase64) return mediaPutBase64;
  try {
    const { mediaSurrealStore } = await import('../../../main/media/media-surreal-store');
    mediaPutBase64 = (input, mimeType, filename) => mediaSurrealStore.putBase64(input, mimeType, filename);
  } catch {
    // media store not available
  }
  return mediaPutBase64;
}

// ── Image fetching ──

/**
 * Fetch a ChatGPT file via the files/download API.
 *
 * Correct endpoint: /backend-api/files/download/{file_id}?conversation_id={conv_id}
 * This works for both old (file-XXX) and new (file_00000000XXX) file ID formats.
 * Returns JSON with download_url → fetch actual bytes.
 *
 * Requires Bearer token obtained from /api/auth/session (page context fetch).
 */
async function fetchChatGPTFile(fileId: string, conversationId: string): Promise<{ dataUrl: string; mimeType: string } | null> {
  try {
    for (const wc of electronWebContents.getAllWebContents()) {
      const url = wc.getURL();
      if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com')) continue;

      const result = await wc.executeJavaScript(`
        (async () => {
          try {
            var fileId = ${JSON.stringify(fileId)};
            var convId = ${JSON.stringify(conversationId)};

            // Get token
            var sessionResp = await fetch('/api/auth/session', { credentials: 'include' });
            if (!sessionResp.ok) return { error: 'no-session', status: sessionResp.status };
            var session = await sessionResp.json();
            var token = session.accessToken;
            if (!token) return { error: 'no-token' };

            var headers = {
              'Authorization': 'Bearer ' + token,
              'Oai-Device-Id': crypto.randomUUID(),
              'Oai-Language': 'en-US',
            };

            // /backend-api/files/download/{file_id}?conversation_id={conv_id}
            var dlResp = await fetch(
              '/backend-api/files/download/' + fileId + '?conversation_id=' + encodeURIComponent(convId),
              { credentials: 'include', headers: headers },
            );
            if (!dlResp.ok) return { error: 'download-endpoint-failed', status: dlResp.status };
            var dlData = await dlResp.json();
            if (!dlData.download_url) return { error: 'no-download-url', data: JSON.stringify(dlData).slice(0, 200) };

            var fileResp = await fetch(dlData.download_url);
            if (!fileResp.ok) return { error: 'file-fetch-failed', status: fileResp.status };

            var blob = await fileResp.blob();
            return await new Promise(function(resolve) {
              var reader = new FileReader();
              reader.onload = function() { resolve({ dataUrl: reader.result, mimeType: blob.type }); };
              reader.onerror = function() { resolve({ error: 'read-error' }); };
              reader.readAsDataURL(blob);
            });
          } catch (e) {
            return { error: String(e) };
          }
        })()
      `);

      if (result?.dataUrl && typeof result.dataUrl === 'string' && result.dataUrl.startsWith('data:')) {
        console.log('[chatgpt-extract] fetchChatGPTFile succeeded:', fileId, 'mime:', result.mimeType, 'size:', result.dataUrl.length);
        return result;
      }
      console.warn('[chatgpt-extract] fetchChatGPTFile failed:', fileId, JSON.stringify(result));
    }
    return null;
  } catch (err) {
    console.warn('[chatgpt-extract] fetchChatGPTFile error:', fileId, err);
    return null;
  }
}

/**
 * Download a ChatGPT file and persist to media store.
 *
 * Uses /backend-api/files/download/{file_id}?conversation_id={conv_id}
 * which works for both old (file-XXX) and new (file_00000000XXX) formats.
 *
 * Returns media:// URL or null.
 */
async function downloadChatGPTFileToMedia(fileId: string, conversationId: string): Promise<string | null> {
  const result = await fetchChatGPTFile(fileId, conversationId);
  if (!result?.dataUrl) return null;

  let dataUrl = result.dataUrl;
  let mimeType = result.mimeType || 'image/png';

  // Fix MIME if octet-stream
  if (mimeType === 'application/octet-stream') {
    mimeType = sniffMimeFromBase64(dataUrl.split(',')[1]) || 'image/png';
    dataUrl = dataUrl.replace(/^data:[^;]+;/, `data:${mimeType};`);
  }

  // Persist to media store
  const put = await ensureMediaStore();
  if (put) {
    const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('png') ? 'png'
      : mimeType.includes('gif') ? 'gif' : 'webp';
    const r = await put(dataUrl, mimeType, `chatgpt-${fileId.slice(-8)}.${ext}`);
    if (r.success && r.mediaUrl) {
      console.log('[chatgpt-extract] file saved to media:', fileId, r.mediaUrl);
      return r.mediaUrl;
    }
  }
  return dataUrl;
}

/**
 * Sniff MIME from base64 when Content-Type is octet-stream.
 */
function sniffMimeFromBase64(b64: string): string | null {
  if (!b64 || b64.length < 16) return null;
  const head = b64.slice(0, 16);
  if (head.startsWith('iVBORw')) return 'image/png';
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('R0lGODl')) return 'image/gif';
  if (head.startsWith('UklGR')) return 'image/webp';
  if (head.startsWith('PHN2Zy') || head.startsWith('PD94bWw')) return 'image/svg+xml';
  if (head.startsWith('JVBER')) return 'application/pdf';
  return null;
}

// ── Sandbox link processing ──

/**
 * Detect if a filename is an image by extension.
 */
function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename);
}

/**
 * Process sandbox:/mnt/data/... links in ChatGPT markdown.
 *
 * Downloads sandbox files via the interpreter/download API and converts to:
 * - Images: `![alt](dataUrl)` → md-to-atoms renders as image block
 * - Files:  `!attach[filename](dataUrl)` → md-to-atoms renders as file block
 * - Fallback: descriptive text if download fails
 *
 * @param messageId  The assistant message ID that contains the sandbox links.
 *                   Required for the download API: message_id={messageId}
 */
async function processSandboxLinks(markdown: string, conversationId: string, messageId: string): Promise<string> {
  // Collect all sandbox references (both ![img] and [link] forms)
  const allRefs = new Map<string, string | null>(); // filename → dataUrl
  const sandboxPattern = /(?:!\[([^\]]*)\]|(?<!!)\[([^\]]+)\])\(sandbox:\/mnt\/data\/([^)]+)\)/g;
  for (const m of markdown.matchAll(sandboxPattern)) {
    const filename = m[3];
    if (!allRefs.has(filename)) allRefs.set(filename, null);
  }

  // Download and persist to media store
  // allRefs: filename → { dataUrl, mediaUrl } or null
  const stored = new Map<string, { dataUrl: string; mediaUrl: string } | null>();

  if (allRefs.size > 0 && conversationId && messageId) {
    const put = await ensureMediaStore();
    const downloads = await Promise.all(
      [...allRefs.keys()].map(async (filename) => {
        const dataUrl = await downloadSandboxFile(filename, conversationId, messageId);
        if (!dataUrl) return { filename, result: null };

        // Persist to media store for proper FileBlock support
        if (put) {
          try {
            const mimeMatch = dataUrl.match(/^data:([^;]+);/);
            const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
            const r = await put(dataUrl, mime, filename);
            if (r.success && r.mediaUrl) {
              return { filename, result: { dataUrl, mediaUrl: r.mediaUrl } };
            }
          } catch {
            // media store failed, use dataUrl directly
          }
        }
        return { filename, result: { dataUrl, mediaUrl: dataUrl } };
      }),
    );
    for (const { filename, result } of downloads) {
      stored.set(filename, result);
    }
  }

  let result = markdown;

  // Process image references: ![alt](sandbox:/mnt/data/file.png)
  const imgRegex = /!\[([^\]]*)\]\(sandbox:\/mnt\/data\/([^)]+)\)/g;
  result = result.replace(imgRegex, (_match, alt, filename) => {
    const s = stored.get(filename);
    if (s) return `![${alt || filename}](${s.mediaUrl})`;
    return `> 🖼️ **${alt || filename}**（ChatGPT 沙箱图片，下载失败）`;
  });

  // Process link references: [text](sandbox:/mnt/data/file.ext)
  // Must distinguish standalone lines (→ !attach block) vs inline (→ plain text).
  const lines = result.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line.includes('sandbox:/mnt/data/')) continue;

    // Check if this line is ONLY a sandbox link (standalone → !attach)
    const standaloneMatch = line.trim().match(/^\[([^\]]+)\]\(sandbox:\/mnt\/data\/([^)]+)\)$/);
    if (standaloneMatch) {
      const [, text, filename] = standaloneMatch;
      const s = stored.get(filename);
      if (s) {
        lines[li] = isImageFile(filename)
          ? `![${text}](${s.mediaUrl})`
          : `!attach[${filename}](${s.mediaUrl})`;
      } else {
        lines[li] = `📎 **${text}**（ChatGPT 沙箱文件: ${filename}，下载失败）`;
      }
    } else {
      // Inline sandbox links → replace with media:// file link (or fallback to bold)
      lines[li] = line.replace(
        /\[([^\]]+)\]\(sandbox:\/mnt\/data\/([^)]+)\)/g,
        (_match, text, filename) => {
          const s = stored.get(filename);
          if (s) {
            // Emit inline file link that result-parser will recognize as fileLink node
            return `[${filename}](${s.mediaUrl})`;
          }
          return `**${text}**`;
        },
      );
    }
  }
  result = lines.join('\n');

  return result;
}

/**
 * Download a ChatGPT Code Interpreter sandbox file.
 *
 * API: GET /backend-api/conversation/{conv_id}/interpreter/download
 *        ?message_id={msg_id}&sandbox_path=/mnt/data/{filename}
 *
 * - message_id is the assistant message that references the sandbox file
 * - Bearer token required
 * - Returns the file bytes directly (not JSON)
 */
async function downloadSandboxFile(
  filename: string,
  conversationId: string,
  messageId: string,
): Promise<string | null> {
  try {
    for (const wc of electronWebContents.getAllWebContents()) {
      const url = wc.getURL();
      if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com')) continue;

      const result = await wc.executeJavaScript(`
        (async () => {
          try {
            var sessionResp = await fetch('/api/auth/session', { credentials: 'include' });
            if (!sessionResp.ok) return { error: 'no-session' };
            var session = await sessionResp.json();
            var token = session.accessToken;
            if (!token) return { error: 'no-token' };

            var apiUrl = '/backend-api/conversation/'
              + ${JSON.stringify(conversationId)}
              + '/interpreter/download?message_id='
              + encodeURIComponent(${JSON.stringify(messageId)})
              + '&sandbox_path='
              + encodeURIComponent('/mnt/data/' + ${JSON.stringify(filename)});

            var resp = await fetch(apiUrl, {
              credentials: 'include',
              headers: { 'Authorization': 'Bearer ' + token },
            });
            if (!resp.ok) return { error: 'fetch-failed', status: resp.status };

            // API returns JSON with download_url → need a second fetch
            var ct = resp.headers.get('content-type') || '';
            var actualBlob;
            if (ct.includes('json')) {
              var data = await resp.json();
              if (!data.download_url) return { error: 'no-download-url-in-json' };
              var fileResp = await fetch(data.download_url, {
                credentials: 'include',
                headers: { 'Authorization': 'Bearer ' + token },
              });
              if (!fileResp.ok) return { error: 'download-url-failed', status: fileResp.status };
              actualBlob = await fileResp.blob();
            } else {
              actualBlob = await resp.blob();
            }

            return await new Promise(function(resolve) {
              var reader = new FileReader();
              reader.onload = function() { resolve({ dataUrl: reader.result }); };
              reader.onerror = function() { resolve({ error: 'read-error' }); };
              reader.readAsDataURL(actualBlob);
            });
          } catch (e) {
            return { error: String(e) };
          }
        })()
      `);

      if (result?.dataUrl && typeof result.dataUrl === 'string' && result.dataUrl.startsWith('data:')) {
        return result.dataUrl;
      }
      if (result?.error) {
        console.warn('[chatgpt-extract] sandbox download failed:', filename, JSON.stringify(result));
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Image URL download ──

/**
 * Download an image from a public URL (e.g. images.openai.com) and persist to media store.
 * Used for image_group search result images — these are public URLs, no Bearer token needed.
 */
async function downloadImageUrlToMedia(imageUrl: string): Promise<string | null> {
  try {
    for (const wc of electronWebContents.getAllWebContents()) {
      const wcUrl = wc.getURL();
      if (!wcUrl.includes('chatgpt.com') && !wcUrl.includes('chat.openai.com')) continue;

      const response = await wc.session.fetch(imageUrl);
      if (!response.ok) continue;

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;

      const put = await ensureMediaStore();
      if (put) {
        const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
        const hash = imageUrl.slice(-12).replace(/[^a-zA-Z0-9]/g, '');
        const r = await put(dataUrl, contentType, `chatgpt-search-${hash}.${ext}`);
        if (r.success && r.mediaUrl) return r.mediaUrl;
      }
      return dataUrl;
    }
    return null;
  } catch (err) {
    console.warn('[chatgpt-extract] downloadImageUrlToMedia error:', err);
    return null;
  }
}

// ── Canvas → Markdown ──

const CANVAS_LANG_MAP: Record<string, string> = {
  react: 'jsx', javascript: 'javascript', python: 'python',
  typescript: 'typescript', html: 'html', css: 'css',
  java: 'java', go: 'go', rust: 'rust', cpp: 'cpp', c: 'c',
};

function canvasToMarkdown(canvas: ChatGPTCanvasData): string {
  if (!canvas.content.trim()) return '';
  const titleAttr = canvas.name ? ` title="${canvas.name}"` : '';
  const tdType = canvas.canvasType || '';
  if (tdType.startsWith('code/') || tdType === 'code') {
    const lang = tdType.replace('code/', '') || '';
    const mdLang = CANVAS_LANG_MAP[lang] || lang || '';
    return `\`\`\`${mdLang}${titleAttr}\n${canvas.content.trim()}\n\`\`\``;
  }
  // Document canvas → markdown code fence with title
  return `\`\`\`markdown${titleAttr}\n${canvas.content.trim()}\n\`\`\``;
}

// ── Turn → Markdown conversion ──

/**
 * Convert a ChatGPT turn to markdown, preserving original content order.
 *
 * Iterates turn.contentParts (text, canvas, file) in the order they appear
 * in the conversation mapping tree, so Canvas blocks, images, and text
 * maintain their correct positions.
 */
async function turnToMarkdown(turn: ChatGPTTurn, _pageId: string, conversationId: string): Promise<string> {
  const parts: string[] = [];

  // Track which fileRefs have already been rendered via contentParts
  const renderedFileIds = new Set<string>();

  for (const part of turn.contentParts) {
    if (part.type === 'text') {
      // Process sandbox links immediately with the correct messageId
      let text = part.text.trim();
      if (text.includes('sandbox:/mnt/data/')) {
        text = await processSandboxLinks(text, conversationId, part.messageId);
      }
      parts.push(text);
    } else if (part.type === 'canvas') {
      const md = canvasToMarkdown(part.canvas);
      if (md) parts.push(md);
    } else if (part.type === 'file') {
      renderedFileIds.add(part.fileId);
      const mediaUrl = await downloadChatGPTFileToMedia(part.fileId, conversationId);
      if (mediaUrl) {
        parts.push(`![](${mediaUrl})`);
      } else {
        parts.push(`> 📎 图片引用: ${part.fileId}（下载失败）`);
      }
    } else if (part.type === 'image_group') {
      // Download image_group images to media store (data-driven, no DOM)
      const imgParts: string[] = [];
      for (const url of part.urls) {
        const mediaUrl = await downloadImageUrlToMedia(url);
        if (mediaUrl) {
          imgParts.push(`![](${mediaUrl})`);
        }
      }
      if (imgParts.length > 0) {
        parts.push(imgParts.join('\n\n'));
      }
    }
  }

  // Fetch remaining file refs not already rendered via contentParts
  for (const fileId of turn.fileRefs) {
    if (renderedFileIds.has(fileId)) continue;
    const mediaUrl = await downloadChatGPTFileToMedia(fileId, conversationId);
    if (mediaUrl) {
      parts.push(`![](${mediaUrl})`);
    } else {
      parts.push(`> 📎 图片引用: ${fileId}（下载失败）`);
    }
  }

  let markdown = parts.join('\n\n');

  return markdown;
}

// ── Public API ──

export async function extractChatGPTTurn(
  pageId: string,
  msgIndex: number,
): Promise<ExtractedTurn | null> {
  const conversation = getChatGPTConversationData(pageId);
  if (!conversation) {
    browserCapabilityTraceWriter.writeDebugLog(pageId, 'chatgpt-extract-turn', {
      msgIndex,
      error: 'no chatgpt conversation data',
    });
    return null;
  }

  // Map DOM msgIndex (visible assistant element index) to turn.
  // Each turn may contain multiple visible assistant DOM elements;
  // domAssistantIndexStart..+domAssistantCount covers which DOM indices it owns.
  let turn: ChatGPTTurn | undefined = conversation.turns[msgIndex]; // fast path: indices align
  if (!turn || msgIndex < turn.domAssistantIndexStart
    || msgIndex >= turn.domAssistantIndexStart + turn.domAssistantCount) {
    turn = conversation.turns.find(t =>
      msgIndex >= t.domAssistantIndexStart
      && msgIndex < t.domAssistantIndexStart + t.domAssistantCount,
    );
  }
  if (!turn) {
    browserCapabilityTraceWriter.writeDebugLog(pageId, 'chatgpt-extract-turn', {
      msgIndex,
      error: 'turn not found',
      totalTurns: conversation.turns.length,
      turnDomRanges: conversation.turns.map(t => ({
        index: t.index, start: t.domAssistantIndexStart, count: t.domAssistantCount,
      })),
    });
    return null;
  }

  const markdown = await turnToMarkdown(turn, pageId, conversation.conversationId);

  const result: ExtractedTurn = {
    index: turn.index,
    userMessage: turn.userMessage,
    markdown: markdown || '_[无文字内容]_',
    timestamp: turn.assistantMessages[0]?.createdAt
      ? new Date(turn.assistantMessages[0].createdAt * 1000).toISOString()
      : undefined,
    artifactCount: turn.fileRefs.length,
  };

  browserCapabilityTraceWriter.writeDebugLog(pageId, 'chatgpt-extract-turn', {
    msgIndex,
    resolvedIndex: result.index,
    userMessagePreview: result.userMessage.slice(0, 100),
    markdownLength: result.markdown.length,
    markdownPreview: result.markdown.slice(0, 800),
    fileRefs: turn.fileRefs,
  });

  return result;
}

export async function extractChatGPTFullConversation(
  pageId: string,
): Promise<ExtractedConversation | null> {
  const conversation = getChatGPTConversationData(pageId);
  if (!conversation || conversation.turns.length === 0) {
    browserCapabilityTraceWriter.writeDebugLog(pageId, 'chatgpt-extract-full', {
      error: conversation ? 'no turns' : 'no chatgpt conversation data',
    });
    return null;
  }

  const turns: ExtractedTurn[] = [];
  for (const turn of conversation.turns) {
    const markdown = await turnToMarkdown(turn, pageId, conversation.conversationId);
    turns.push({
      index: turn.index,
      userMessage: turn.userMessage,
      markdown: markdown || '_[无文字内容]_',
      timestamp: turn.assistantMessages[0]?.createdAt
        ? new Date(turn.assistantMessages[0].createdAt * 1000).toISOString()
        : undefined,
      artifactCount: turn.fileRefs.length,
    });
  }

  const result: ExtractedConversation = {
    title: conversation.title || '未命名对话',
    model: conversation.model,
    turns,
  };

  browserCapabilityTraceWriter.writeDebugLog(pageId, 'chatgpt-extract-full', {
    title: result.title,
    model: result.model,
    totalTurns: turns.length,
    turns: turns.map((t) => ({
      index: t.index,
      userMessagePreview: t.userMessage.slice(0, 80),
      markdownLength: t.markdown.length,
      fileRefCount: t.artifactCount,
    })),
  });

  return result;
}
