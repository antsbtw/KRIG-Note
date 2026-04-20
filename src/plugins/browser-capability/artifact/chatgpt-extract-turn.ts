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
  getChatGPTTextdocs,
  type ChatGPTTurn,
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
 * Fetch a file from ChatGPT's estuary API using Bearer token.
 * Returns base64 data URL or null.
 */
async function fetchChatGPTFile(fileId: string): Promise<{ dataUrl: string; mimeType: string } | null> {
  try {
    for (const wc of electronWebContents.getAllWebContents()) {
      const url = wc.getURL();
      if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com')) continue;

      const result = await wc.executeJavaScript(`
        (async () => {
          try {
            // Get token
            const sessionResp = await fetch('/api/auth/session', { credentials: 'include' });
            if (!sessionResp.ok) return null;
            const session = await sessionResp.json();
            const token = session.accessToken;
            if (!token) return null;

            // Fetch file via download endpoint to get the actual URL
            const dlResp = await fetch('/backend-api/files/${fileId}/download', {
              credentials: 'include',
              headers: { 'Authorization': 'Bearer ' + token },
            });
            if (!dlResp.ok) return null;
            const dlData = await dlResp.json();
            const downloadUrl = dlData.download_url;
            if (!downloadUrl) return null;

            // Fetch the actual file bytes
            const fileResp = await fetch(downloadUrl);
            if (!fileResp.ok) return null;
            const blob = await fileResp.blob();
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve({ dataUrl: reader.result, mimeType: blob.type });
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            });
          } catch (e) {
            return null;
          }
        })()
      `);

      if (result?.dataUrl) return result;
    }
    return null;
  } catch {
    return null;
  }
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

// ── DOM image extraction ──

/**
 * Extract rendered images from the ChatGPT DOM for a specific turn.
 *
 * Matches the correct DOM container by comparing assistant message text
 * prefix (first 30 chars) against each [data-message-author-role="assistant"]
 * element's textContent. This avoids index mismatches caused by invisible
 * assistant messages (thoughts, code, reasoning_recap) in the DOM.
 *
 * Downloads each image and persists to media store, returns media:// URLs.
 */
async function extractDomImages(textPrefix: string): Promise<string[]> {
  if (!textPrefix) return [];
  try {
    const searchPrefix = textPrefix.replace(/\s+/g, ' ').trim().slice(0, 40);
    console.log('[chatgpt-extract] extractDomImages searching for:', JSON.stringify(searchPrefix));

    for (const wc of electronWebContents.getAllWebContents()) {
      const url = wc.getURL();
      if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com')) continue;

      const debugResult = await wc.executeJavaScript(`
        (function() {
          var prefix = ${JSON.stringify(searchPrefix)};
          var containers = document.querySelectorAll('[data-message-author-role="assistant"]');
          var debug = { containerCount: containers.length, matched: -1, imgCount: 0, imgs: [] };
          var target = null;
          for (var i = 0; i < containers.length; i++) {
            var text = (containers[i].textContent || '').replace(/\\s+/g, ' ').trim();
            if (text.indexOf(prefix) >= 0) {
              target = containers[i];
              debug.matched = i;
              debug.matchedTextPreview = text.slice(0, 80);
              break;
            }
          }
          if (!target) {
            // Show first few containers' text for debugging
            debug.containerPreviews = [];
            for (var k = 0; k < Math.min(5, containers.length); k++) {
              debug.containerPreviews.push((containers[k].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60));
            }
            return debug;
          }
          var imgs = target.querySelectorAll('img');
          debug.imgCount = imgs.length;
          for (var j = 0; j < imgs.length; j++) {
            var img = imgs[j];
            var src = img.src || '';
            var w = img.naturalWidth || 0;
            var h = img.naturalHeight || 0;
            debug.imgs.push({ src: src.slice(0, 100), w: w, h: h });
            if ((w > 100 || h > 100) && src.startsWith('https://')) {
              debug.imgs[debug.imgs.length - 1].selected = true;
            }
          }
          return debug;
        })()
      `);

      console.log('[chatgpt-extract] DOM probe result:', JSON.stringify(debugResult));

      // Now do the actual extraction if we found images
      if (!debugResult || debugResult.matched === -1 || debugResult.matched === undefined) return [];

      const imgUrls: string[] = await wc.executeJavaScript(`
        (function() {
          var prefix = ${JSON.stringify(searchPrefix)};
          var containers = document.querySelectorAll('[data-message-author-role="assistant"]');
          var target = null;
          for (var i = 0; i < containers.length; i++) {
            var text = (containers[i].textContent || '').replace(/\\s+/g, ' ').trim();
            if (text.indexOf(prefix) >= 0) { target = containers[i]; break; }
          }
          if (!target) return [];
          var imgs = target.querySelectorAll('img');
          var urls = [];
          for (var j = 0; j < imgs.length; j++) {
            var img = imgs[j];
            var src = img.src || '';
            var w = img.naturalWidth || 0;
            var h = img.naturalHeight || 0;
            if ((w > 100 || h > 100) && src.startsWith('https://')) {
              urls.push(src);
            }
          }
          return urls;
        })()
      `);

      console.log('[chatgpt-extract] image URLs found:', imgUrls?.length ?? 0);

      if (!imgUrls || imgUrls.length === 0) return [];

      // Download images — use Electron's net module from main process to avoid CORS
      const put = await ensureMediaStore();
      const results: string[] = [];
      for (const imgUrl of imgUrls) {
        try {
          // Use main process fetch (no CORS restrictions)
          const { net } = await import('electron');
          const dataUrl = await new Promise<string | null>((resolve) => {
            const request = net.request(imgUrl);
            const chunks: Buffer[] = [];
            request.on('response', (response) => {
              if (response.statusCode !== 200) {
                console.warn('[chatgpt-extract] image download failed:', imgUrl.slice(0, 80), 'status:', response.statusCode);
                resolve(null);
                return;
              }
              const contentType = response.headers['content-type']?.[0] || response.headers['content-type'] || 'image/png';
              response.on('data', (chunk: Buffer) => chunks.push(chunk));
              response.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const b64 = buffer.toString('base64');
                resolve(`data:${contentType};base64,${b64}`);
              });
              response.on('error', () => resolve(null));
            });
            request.on('error', (err) => {
              console.warn('[chatgpt-extract] image request error:', imgUrl.slice(0, 80), err.message);
              resolve(null);
            });
            request.end();
          });

          if (dataUrl && put) {
            const mimeMatch = dataUrl.match(/^data:([^;]+);/);
            const mime = mimeMatch ? mimeMatch[1] : 'image/png';
            const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : 'webp';
            const r = await put(dataUrl, mime, `chatgpt-image.${ext}`);
            if (r.success && r.mediaUrl) {
              console.log('[chatgpt-extract] image saved to media store:', r.mediaUrl);
              results.push(r.mediaUrl);
              continue;
            }
          }
          if (dataUrl) results.push(dataUrl);
        } catch (err) {
          console.warn('[chatgpt-extract] image download error:', err);
        }
      }
      return results;
    }
    return [];
  } catch {
    return [];
  }
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

// ── Turn → Markdown conversion ──

/**
 * Convert a ChatGPT turn to markdown, including images.
 */
async function turnToMarkdown(turn: ChatGPTTurn, pageId: string, conversationId: string): Promise<string> {
  const parts: string[] = [];

  // Combine assistant message text
  for (const msg of turn.assistantMessages) {
    if (msg.text.trim()) {
      parts.push(msg.text.trim());
    }
  }

  // Fetch DOM-rendered images (image_group search results, inline images, etc.)
  // These are images visible on the ChatGPT page but not in the API data (no file_id).
  // Strip markdown formatting to match DOM textContent.
  const rawText = turn.assistantMessages[0]?.text || '';
  const plainText = rawText.replace(/\*\*|__|[*_`#\[\]]/g, '').replace(/\n+/g, ' ').trim();
  const domImages = await extractDomImages(plainText);
  if (domImages.length > 0) {
    for (const img of domImages) {
      parts.push(`![](${img})`);
    }
  }

  // Fetch images for file refs (DALL·E / Code Interpreter via estuary)
  if (turn.fileRefs.length > 0) {
    for (const fileId of turn.fileRefs) {
      try {
        const file = await fetchChatGPTFile(fileId);
        if (file?.dataUrl) {
          parts.push(`![${fileId}](${file.dataUrl})`);
        } else {
          parts.push(`> 📎 图片引用: ${fileId}（下载失败）`);
        }
      } catch {
        parts.push(`> 📎 图片引用: ${fileId}（下载失败）`);
      }
    }
  }

  // Append Canvas (textdocs) content if any
  const textdocs = getChatGPTTextdocs(pageId);
  if (textdocs.length > 0) {
    for (const td of textdocs) {
      if (td.content.trim()) {
        parts.push(`\n---\n\n**📄 Canvas: ${td.title}**\n\n${td.content.trim()}`);
      }
    }
  }

  // Process sandbox:// links (Code Interpreter files)
  // Use the first assistant message's ID as the message_id for the download API
  const messageId = turn.assistantMessages[0]?.id || '';
  let markdown = parts.join('\n\n');
  markdown = await processSandboxLinks(markdown, conversationId, messageId);

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

  const turn = conversation.turns[msgIndex];
  if (!turn) {
    browserCapabilityTraceWriter.writeDebugLog(pageId, 'chatgpt-extract-turn', {
      msgIndex,
      error: 'turn not found',
      totalTurns: conversation.turns.length,
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
