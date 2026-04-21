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
            var fileId = ${JSON.stringify(fileId)};

            // Get token
            var sessionResp = await fetch('/api/auth/session', { credentials: 'include' });
            if (!sessionResp.ok) return { error: 'no-session', status: sessionResp.status };
            var session = await sessionResp.json();
            var token = session.accessToken;
            if (!token) return { error: 'no-token' };

            // ChatGPT API requires these headers (discovered via community exporters)
            var headers = {
              'Authorization': 'Bearer ' + token,
              'Oai-Device-Id': crypto.randomUUID(),
              'Oai-Language': 'en-US',
            };

            // files/download → download_url → fetch actual bytes
            var dlResp = await fetch('/backend-api/files/' + fileId + '/download', {
              credentials: 'include',
              headers: headers,
            });
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
 * Two file_id formats exist:
 * - file-XXXX (old, Code Interpreter) → /backend-api/files/{id}/download → download_url
 * - file_00000000XXXX (new, DALL·E gpt-image-1) → signed estuary URL from DOM <img src>
 *
 * Returns media:// URL or null.
 */
async function downloadChatGPTFileToMedia(fileId: string): Promise<string | null> {
  let dataUrl: string | null = null;
  let mimeType = 'image/png';

  // Old format (file-XXX): use files/download API
  if (fileId.startsWith('file-')) {
    const result = await fetchChatGPTFile(fileId);
    if (result?.dataUrl) {
      dataUrl = result.dataUrl;
      mimeType = result.mimeType || 'image/png';
    }
  }

  // New format (file_XXX) or API failed: resolve signed URL from page
  if (!dataUrl) {
    dataUrl = await fetchFileFromSignedUrl(fileId);
  }

  if (!dataUrl) return null;

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
 * Download a file using its signed estuary URL from the ChatGPT page.
 *
 * DALL·E gpt-image-1 files use file_00000000... IDs that the files/download
 * API rejects as "Invalid file_id". The only way to download them is via
 * the estuary signed URL (with ts/sig params) that ChatGPT's frontend JS
 * generates.
 *
 * Method:
 * 1. executeJavaScript to resolve the signed URL from the page's <img> elements
 * 2. session.fetch to download the bytes (uses Chrome network stack with session cookies)
 *
 * This is NOT a DOM fallback — it's the correct download path for new-format
 * file IDs, matching how ChatGPT's own client loads these images.
 */
async function fetchFileFromSignedUrl(fileId: string): Promise<string | null> {
  try {
    for (const wc of electronWebContents.getAllWebContents()) {
      const wcUrl = wc.getURL();
      if (!wcUrl.includes('chatgpt.com') && !wcUrl.includes('chat.openai.com')) continue;

      // Step 1: Get the signed URL from page (ChatGPT's JS already generated it)
      const signedUrl: string | null = await wc.executeJavaScript(`
        (function() {
          var imgs = document.querySelectorAll('img');
          for (var i = 0; i < imgs.length; i++) {
            if ((imgs[i].src || '').indexOf(${JSON.stringify(fileId)}) >= 0 && imgs[i].naturalWidth > 50) {
              return imgs[i].src;
            }
          }
          return null;
        })()
      `);

      if (!signedUrl) continue;
      console.log('[chatgpt-extract] resolved signed URL for', fileId);

      // Step 2: Download via session.fetch (Chrome network stack, auto-cookies)
      const response = await wc.session.fetch(signedUrl);
      if (!response.ok) {
        console.warn('[chatgpt-extract] session.fetch failed:', fileId, response.status);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    }
    return null;
  } catch (err) {
    console.warn('[chatgpt-extract] fetchFileFromSignedUrl error:', err);
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

// ── Image group extraction ──

/**
 * Extract all images from ChatGPT image_group widgets (carousel/gallery).
 *
 * Returns a flat array of all image URLs across all groups.
 * Each image_group is handled independently:
 *   1. Find thumbnail groups via DOM ancestor analysis (5th-level ancestor)
 *   2. Click each group's first thumbnail to open its carousel
 *   3. Collect unique URLs from that carousel
 *   4. Close carousel, proceed to next group
 *
 * All operations via executeJavaScript injection + session.fetch download.
 */
async function extractImageGroupImages(textPrefix: string): Promise<string[][]> {
  if (!textPrefix) return [];
  try {
    const searchPrefix = textPrefix.replace(/\s+/g, ' ').trim().slice(0, 40);
    console.log('[chatgpt-extract] extractImageGroupImages searching for:', JSON.stringify(searchPrefix));

    for (const wc of electronWebContents.getAllWebContents()) {
      const url = wc.getURL();
      if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com')) continue;

      // Inject script: find groups, open each carousel, collect URLs per group
      const imgUrls: string[][] = await wc.executeJavaScript(`
        (async function() {
          var prefix = ${JSON.stringify(searchPrefix)};

          // Find the assistant container
          var containers = document.querySelectorAll('[data-message-author-role="assistant"]');
          var target = null;
          for (var i = 0; i < containers.length; i++) {
            var text = (containers[i].textContent || '').replace(/\\s+/g, ' ').trim();
            if (text.indexOf(prefix) >= 0) { target = containers[i]; break; }
          }
          if (!target) return [];

          // Find all content thumbnails
          var allThumbs = [];
          var thumbImgs = target.querySelectorAll('img');
          for (var j = 0; j < thumbImgs.length; j++) {
            if (thumbImgs[j].naturalWidth > 80 && thumbImgs[j].src.startsWith('https://images.openai.com/')) {
              allThumbs.push(thumbImgs[j]);
            }
          }
          if (allThumbs.length === 0) return [];

          // Group thumbnails by 5th-level ancestor (image_group container)
          var groupMap = new Map();
          allThumbs.forEach(function(img) {
            var el = img;
            for (var d = 0; d < 5; d++) { if (el.parentElement) el = el.parentElement; }
            if (!groupMap.has(el)) groupMap.set(el, []);
            groupMap.get(el).push(img);
          });

          // For each group: click first thumb → collect carousel URLs → close
          var allGroups = [];
          var groupEntries = Array.from(groupMap.values());
          var globalSeen = new Set();

          for (var gi = 0; gi < groupEntries.length; gi++) {
            var groupThumbs = groupEntries[gi];
            var firstThumb = groupThumbs[0];

            // Record URLs before opening carousel
            var beforeUrls = new Set();
            document.querySelectorAll('img').forEach(function(img) {
              if (img.naturalWidth > 80 && img.src.startsWith('https://images.openai.com/')) {
                beforeUrls.add(img.src);
              }
            });

            // Click to open this group's carousel
            firstThumb.click();
            await new Promise(function(r) { setTimeout(r, 1500); });

            // Collect all images now visible (includes carousel images)
            var carouselUrls = new Set();
            document.querySelectorAll('img').forEach(function(img) {
              if (img.naturalWidth > 80 && img.src.startsWith('https://images.openai.com/')) {
                carouselUrls.add(img.src);
              }
            });

            // This group's images = new URLs from carousel + this group's thumbnails
            var groupThumbUrls = new Set(groupThumbs.map(function(t) { return t.src; }));
            var groupUrls = [];
            carouselUrls.forEach(function(url) {
              if ((!beforeUrls.has(url) || groupThumbUrls.has(url)) && !globalSeen.has(url)) {
                globalSeen.add(url);
                groupUrls.push(url);
              }
            });

            allGroups.push(groupUrls);

            // Close carousel
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise(function(r) { setTimeout(r, 500); });
          }

          return allGroups;
        })()
      `);

      const groups = imgUrls || [];
      console.log('[chatgpt-extract] image groups found:', groups.length, groups.map((g: string[]) => g.length));

      if (groups.length === 0) return [];

      // Download images per group via session.fetch
      const put = await ensureMediaStore();
      const resultGroups: string[][] = [];
      for (const group of groups) {
        const groupResults: string[] = [];
        const groupSeen = new Set<string>();
        for (const imgUrl of group) {
          try {
            const response = await wc.session.fetch(imgUrl);
            if (!response.ok) {
              console.warn('[chatgpt-extract] image download failed:', imgUrl.slice(0, 80), response.status);
              continue;
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            const contentType = response.headers.get('content-type') || 'application/octet-stream';
            const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;

            if (put) {
              const mimeMatch = dataUrl.match(/^data:([^;]+);/);
              const mime = mimeMatch ? mimeMatch[1] : 'image/png';
              const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : 'webp';
              const r = await put(dataUrl, mime, `chatgpt-image.${ext}`);
              if (r.success && r.mediaUrl) {
                // Dedup by mediaUrl (same content hash → same mediaUrl)
                if (!groupSeen.has(r.mediaUrl)) {
                  groupSeen.add(r.mediaUrl);
                  groupResults.push(r.mediaUrl);
                }
                continue;
              }
            }
            if (!groupSeen.has(dataUrl)) {
              groupSeen.add(dataUrl);
              groupResults.push(dataUrl);
            }
          } catch (err) {
            console.warn('[chatgpt-extract] image download error:', err);
          }
        }
        resultGroups.push(groupResults);
      }
      console.log('[chatgpt-extract] downloaded groups:', resultGroups.map(g => g.length));
      return resultGroups;
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

  // Check if this turn contains {{IMAGE_GROUP_N}} placeholders
  const rawText = turn.assistantMessages[0]?.text || '';
  const plainText = rawText.replace(/\*\*|__|[*_`#\[\]]/g, '').replace(/\n+/g, ' ').trim();
  const imageGroupCount = (parts.join('\n').match(/\{\{IMAGE_GROUP_\d+\}\}/g) || []).length;
  let imageGroups: string[][] = [];

  if (imageGroupCount > 0) {
    // Extract images per group (each group opened independently via carousel)
    imageGroups = await extractImageGroupImages(plainText);
    console.log('[chatgpt-extract] image_group results:', imageGroups.map(g => g.length));
  }

  // Fetch images for file refs (DALL·E / Code Interpreter)
  // Strategy: files/download API (file- prefix) or DOM signed URL (file_ prefix)
  if (turn.fileRefs.length > 0 && imageGroups.flat().length === 0) {
    for (const fileId of turn.fileRefs) {
      const mediaUrl = await downloadChatGPTFileToMedia(fileId);
      if (mediaUrl) {
        parts.push(`![](${mediaUrl})`);
      } else {
        parts.push(`> 📎 图片引用: ${fileId}（下载失败）`);
      }
    }
  }

  // Append Canvas (textdocs) content if any
  const textdocs = getChatGPTTextdocs(pageId);
  if (textdocs.length > 0) {
    for (const td of textdocs) {
      if (!td.content.trim()) continue;
      const tdType = td.textdocType || '';
      if (tdType.startsWith('code/') || tdType === 'code') {
        // Code canvas → fenced code block with language
        const lang = tdType.replace('code/', '') || '';
        // Map canvas language names to markdown lang identifiers
        const langMap: Record<string, string> = {
          react: 'jsx', javascript: 'javascript', python: 'python',
          typescript: 'typescript', html: 'html', css: 'css',
          java: 'java', go: 'go', rust: 'rust', cpp: 'cpp', c: 'c',
        };
        const mdLang = langMap[lang] || lang || '';
        parts.push(`\n---\n\n**📄 Canvas: ${td.title}**\n\n\`\`\`${mdLang}\n${td.content.trim()}\n\`\`\``);
      } else {
        // Document canvas → markdown text
        parts.push(`\n---\n\n**📄 Canvas: ${td.title}**\n\n${td.content.trim()}`);
      }
    }
  }

  // Process sandbox:// links (Code Interpreter files)
  const messageId = turn.assistantMessages[0]?.id || '';
  let markdown = parts.join('\n\n');
  markdown = await processSandboxLinks(markdown, conversationId, messageId);

  // Replace {{IMAGE_GROUP_N}} placeholders with extracted images at correct positions
  for (let gi = 0; gi < imageGroups.length; gi++) {
    const group = imageGroups[gi];
    if (group.length > 0) {
      const imageMarkdown = group.map(url => `![](${url})`).join('\n\n');
      markdown = markdown.replace(`{{IMAGE_GROUP_${gi}}}`, imageMarkdown);
    }
  }
  // Remove any remaining unreplaced placeholders
  markdown = markdown.replace(/\{\{IMAGE_GROUP_\d+\}\}/g, '');

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
