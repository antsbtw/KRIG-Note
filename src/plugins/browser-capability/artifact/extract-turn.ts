/**
 * Extract a single conversation turn (by message index) using
 * Browser Capability data instead of DOM simulation.
 *
 * Returns structured data that the renderer can turn into markdown
 * and send to Note via as:append-turn.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import {
  getConversationData,
  type ConversationMessage,
  type MessageArtifact,
} from './conversation-query';
import { browserCapabilityTraceWriter } from '../persistence';

// Media store integration — saves artifact files and returns media:// URLs
let mediaPutBase64: ((input: string, mimeType?: string, filename?: string) =>
  Promise<{ success: boolean; mediaUrl?: string }>) | null = null;

async function ensureMediaStore(): Promise<typeof mediaPutBase64> {
  if (mediaPutBase64) return mediaPutBase64;
  try {
    const { mediaSurrealStore } = await import('../../../main/media/media-surreal-store');
    mediaPutBase64 = (input, mimeType, filename) => mediaSurrealStore.putBase64(input, mimeType, filename);
  } catch {
    // media store not available in this context
  }
  return mediaPutBase64;
}

// ── Public types ──

export type ExtractedTurn = {
  index: number;
  userMessage: string;
  markdown: string;
  timestamp?: string;
  artifactCount: number;
};

export type ExtractedConversation = {
  title: string;
  model?: string;
  turns: ExtractedTurn[];
};

// ── Pre-extraction cleanup ──

/**
 * Clear previously extracted artifact files from media store.
 * Called before each full extraction to ensure clean state.
 */
function clearExtractedArtifactCache(): void {
  try {
    const mediaDir = path.join(app.getPath('userData'), 'krig-data', 'media', 'images');
    if (!fs.existsSync(mediaDir)) return;
    const files = fs.readdirSync(mediaDir);
    let cleared = 0;
    for (const file of files) {
      if (file.endsWith('.svg')) {
        fs.unlinkSync(path.join(mediaDir, file));
        cleared++;
      }
    }
  } catch (err) {
    console.warn('[extract-turn] failed to clear artifact cache', err);
  }
}

// ── SVG preprocessing ──

/**
 * 完整的 Claude SVG 暗色主题样式表。
 * 颜色值从 Claude 页面下载的 SVG 的 computed inline styles 中提取。
 * 选择器覆盖所有 SVG 图形元素类型（rect/ellipse/circle/path/polygon）。
 */
const CLAUDE_SVG_STYLESHEET = `
  /* 基础字体 */
  text { font-family: "Anthropic Sans", -apple-system, system-ui, sans-serif; fill: rgb(194,192,182); }
  .ts { font-size: 12px; fill: rgb(194,192,182); }
  .th { font-size: 14px; fill: rgb(211,209,199); font-weight: 500; }

  /* 图形元素通用 */
  .node rect, .node ellipse, .node circle, .node path, .node polygon { stroke-width: 0.5; }

  /* c-gray */
  .c-gray > rect, .c-gray > ellipse, .c-gray > circle, .c-gray > path, .c-gray > polygon { fill: rgb(68,68,65); stroke: rgb(180,178,169); }
  .c-gray > text, .c-gray > text.th { fill: rgb(211,209,199); }
  .c-gray > text.ts, .c-gray text.ts { fill: rgb(180,178,169); }

  /* c-amber */
  .c-amber > rect, .c-amber > ellipse, .c-amber > circle, .c-amber > path, .c-amber > polygon { fill: rgb(99,56,6); stroke: rgb(239,159,39); }
  .c-amber > text.th, .c-amber text.th { fill: rgb(250,199,117); }
  .c-amber > text.ts, .c-amber text.ts { fill: rgb(239,159,39); }

  /* c-coral */
  .c-coral > rect, .c-coral > ellipse, .c-coral > circle, .c-coral > path, .c-coral > polygon { fill: rgb(113,43,19); stroke: rgb(240,153,123); }
  .c-coral > text.th, .c-coral text.th { fill: rgb(245,196,179); }
  .c-coral > text.ts, .c-coral text.ts { fill: rgb(240,153,123); }

  /* c-teal */
  .c-teal > rect, .c-teal > ellipse, .c-teal > circle, .c-teal > path, .c-teal > polygon { fill: rgb(8,80,65); stroke: rgb(93,202,165); }
  .c-teal > text.th, .c-teal text.th { fill: rgb(159,225,203); }
  .c-teal > text.ts, .c-teal text.ts { fill: rgb(93,202,165); }

  /* c-purple */
  .c-purple > rect, .c-purple > ellipse, .c-purple > circle, .c-purple > path, .c-purple > polygon { fill: rgb(60,52,137); stroke: rgb(175,169,236); }
  .c-purple > text.th, .c-purple text.th { fill: rgb(206,203,246); }
  .c-purple > text.ts, .c-purple text.ts { fill: rgb(175,169,236); }

  /* c-blue */
  .c-blue > rect, .c-blue > ellipse, .c-blue > circle, .c-blue > path, .c-blue > polygon { fill: rgb(20,60,120); stroke: rgb(100,160,240); }
  .c-blue > text.th, .c-blue text.th { fill: rgb(180,210,250); }
  .c-blue > text.ts, .c-blue text.ts { fill: rgb(100,160,240); }

  /* c-green */
  .c-green > rect, .c-green > ellipse, .c-green > circle, .c-green > path, .c-green > polygon { fill: rgb(15,70,40); stroke: rgb(80,200,120); }
  .c-green > text.th, .c-green text.th { fill: rgb(160,230,180); }
  .c-green > text.ts, .c-green text.ts { fill: rgb(80,200,120); }

  /* c-red */
  .c-red > rect, .c-red > ellipse, .c-red > circle, .c-red > path, .c-red > polygon { fill: rgb(100,30,30); stroke: rgb(230,80,80); }
  .c-red > text.th, .c-red text.th { fill: rgb(245,170,170); }
  .c-red > text.ts, .c-red text.ts { fill: rgb(230,80,80); }

  /* c-indigo */
  .c-indigo > rect, .c-indigo > ellipse, .c-indigo > circle, .c-indigo > path, .c-indigo > polygon { fill: rgb(45,40,120); stroke: rgb(130,120,220); }
  .c-indigo > text.th, .c-indigo text.th { fill: rgb(190,185,240); }
  .c-indigo > text.ts, .c-indigo text.ts { fill: rgb(130,120,220); }
`;

const CLAUDE_CSS_VARS: Record<string, string> = {
  'var(--color-border-tertiary)': 'rgba(222,220,209,0.15)',
  'var(--color-border-secondary)': 'rgba(222,220,209,0.3)',
  'var(--color-border-primary)': 'rgba(222,220,209,0.5)',
  'var(--color-text-primary)': 'rgb(250,249,245)',
  'var(--color-text-secondary)': 'rgb(194,192,182)',
  'var(--color-text-tertiary)': 'rgb(148,146,137)',
  'var(--color-bg-primary)': 'rgb(43,43,40)',
  'var(--color-bg-secondary)': 'rgb(55,55,52)',
  'var(--color-bg-tertiary)': 'rgb(68,68,65)',
  'var(--color-background-primary)': 'rgb(43,43,40)',
  'var(--color-background-secondary)': 'rgb(55,55,52)',
  'var(--color-background-tertiary)': 'rgb(68,68,65)',
  'var(--text-color-primary)': 'rgb(250,249,245)',
  'var(--text-color-secondary)': 'rgb(194,192,182)',
  'var(--text-color-tertiary)': 'rgb(148,146,137)',
  'var(--bg-color)': 'rgb(43,43,40)',
  'var(--fg-color)': 'rgb(250,249,245)',
};

/**
 * Prepare SVG for rendering — 让 widget_code 源码自包含：
 * 1. Add xmlns
 * 2. Remove event handlers（onclick 含未转义引号会破坏 XML）
 * 3. Replace CSS variables with concrete color values
 * 4. Inject complete <style> block（覆盖所有 CSS 类和图形元素类型）
 *
 * 目标：保存到 media store 的 SVG 不依赖外部 CSS，和从 Claude 下载的原件渲染效果一致。
 */
function prepareSvgForDom(raw: string): string {
  let svg = raw;

  // 1. xmlns
  if (!svg.includes('xmlns=')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // 2. Remove onclick/onmouseover/etc event handler attributes
  svg = svg.replace(/ on\w+=(?:"[^>]*>|'[^>]*>)/g, '>');
  svg = svg.split('\n').map((line) => {
    if (/ on\w+=/.test(line)) {
      return line.replace(/ on\w+=.*?(?=>)/, '');
    }
    return line;
  }).join('\n');

  // 3. Replace CSS variables with concrete values
  for (const [cssVar, value] of Object.entries(CLAUDE_CSS_VARS)) {
    while (svg.includes(cssVar)) {
      svg = svg.replace(cssVar, value);
    }
  }

  // 4. Inject <style> block（如果 SVG 中没有已有的 <style>）
  if (!svg.includes('<style')) {
    const svgOpenEnd = svg.indexOf('>', svg.indexOf('<svg'));
    if (svgOpenEnd > 0) {
      svg = svg.slice(0, svgOpenEnd + 1) + `\n<style>${CLAUDE_SVG_STYLESHEET}</style>\n` + svg.slice(svgOpenEnd + 1);
    }
  }

  return svg;
}

// ── Artifact → markdown ──

async function artifactToMarkdown(artifact: MessageArtifact): Promise<string> {
  const content = artifact.content;
  if (!content) {
    console.warn('[extract-turn] artifact has no content', { title: artifact.title });
    return `> **${artifact.title}** — artifact 内容不可用\n`;
  }

  if (content.type === 'widget_code') {
    if (content.mimeType === 'image/svg+xml') {
      // SVG: save to media store, reference by media:// URL
      try {
        const put = await ensureMediaStore();
        if (put) {
          let svgCode = prepareSvgForDom(content.code);
          const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgCode, 'utf-8').toString('base64')}`;
          const result = await put(dataUrl, 'image/svg+xml', `${artifact.title}.svg`);
          if (result.success && result.mediaUrl) {
            return `![${artifact.title}](${result.mediaUrl})\n`;
          }
        } else {
          console.warn('[extract-turn] media store not available');
        }
      } catch (err) {
        console.warn('[extract-turn] media store put failed', { title: artifact.title, error: err });
      }
      // Fallback: inline data URL
      const encoded = Buffer.from(content.code, 'utf-8').toString('base64');
      return `![${artifact.title}](data:image/svg+xml;base64,${encoded})\n`;
    }
    // HTML widget: save to media store, reference as !html block
    try {
      const put = await ensureMediaStore();
      if (put) {
        const dataUrl = `data:text/html;base64,${Buffer.from(content.code, 'utf-8').toString('base64')}`;
        const result = await put(dataUrl, 'text/html', `${artifact.title}.html`);
        if (result.success && result.mediaUrl) {
          return `!html[${artifact.title}](${result.mediaUrl})\n`;
        }
      }
    } catch (err) {
      console.warn('[extract-turn] html media store put failed', { title: artifact.title, error: err });
    }
    // Fallback: code block
    return `\`\`\`html\n${content.code.trimEnd()}\n\`\`\`\n`;
  }

  if (content.type === 'file_text') {
    const ext = content.path.split('.').pop()?.toLowerCase() ?? '';

    // SVG files → save to media store, render as image block
    if (ext === 'svg') {
      try {
        const put = await ensureMediaStore();
        if (put) {
          const svgCode = prepareSvgForDom(content.text);
          const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgCode, 'utf-8').toString('base64')}`;
          const filename = content.path.split('/').pop() || `${artifact.title}.svg`;
          const result = await put(dataUrl, 'image/svg+xml', filename);
          if (result.success && result.mediaUrl) {
            return `![${artifact.title}](${result.mediaUrl})\n`;
          }
        }
      } catch (err) {
        console.warn('[extract-turn] svg file_text put failed', { title: artifact.title, error: err });
      }
    }

    // HTML files → save to media store, render as html-block
    if (ext === 'html' || ext === 'htm') {
      try {
        const put = await ensureMediaStore();
        if (put) {
          const dataUrl = `data:text/html;base64,${Buffer.from(content.text, 'utf-8').toString('base64')}`;
          const filename = content.path.split('/').pop() || `${artifact.title}.html`;
          const result = await put(dataUrl, 'text/html', filename);
          if (result.success && result.mediaUrl) {
            return `!html[${artifact.title}](${result.mediaUrl})\n`;
          }
        }
      } catch (err) {
        console.warn('[extract-turn] html file_text put failed', { title: artifact.title, error: err });
      }
    }

    const lang = ext === 'md' ? 'markdown'
      : ext === 'py' ? 'python'
      : ext === 'ts' ? 'typescript'
      : ext === 'js' ? 'javascript'
      : ext || 'text';
    if (ext === 'md' || ext === 'txt') {
      return content.text.trimEnd() + '\n';
    }
    return `\`\`\`${lang}\n${content.text.trimEnd()}\n\`\`\`\n`;
  }

  if (content.type === 'downloaded') {
    if (content.mimeType?.startsWith('image/') || content.storageRef.match(/\.(svg|png|jpg|jpeg|gif|webp)$/i)) {
      return `![${artifact.title}](${content.storageRef})\n`;
    }
    // HTML files → save to media store as html-block
    if (content.storageRef.match(/\.html?$/i) || content.mimeType === 'text/html') {
      try {
        const fs = await import('node:fs');
        const htmlContent = fs.readFileSync(content.storageRef, 'utf-8');
        const put = await ensureMediaStore();
        if (put && htmlContent) {
          const dataUrl = `data:text/html;base64,${Buffer.from(htmlContent, 'utf-8').toString('base64')}`;
          const filename = content.storageRef.split('/').pop() || `${artifact.title}.html`;
          const result = await put(dataUrl, 'text/html', filename);
          if (result.success && result.mediaUrl) {
            return `!html[${artifact.title}](${result.mediaUrl})\n`;
          }
        }
      } catch (err) {
        console.warn('[extract-turn] downloaded html put failed', { title: artifact.title, error: err });
      }
    }
    return `> 📎 [${artifact.title}](${content.storageRef})\n`;
  }

  if (content.type === 'local_resource') {
    // Proactively download from Claude sandbox via API
    try {
      const fileContent = await downloadLocalResource(content.filePath);
      if (fileContent) {
        const put = await ensureMediaStore();
        const filename = content.filePath.split('/').pop() || `${artifact.title}`;
        const isHtml = content.mimeType === 'text/html' || filename.match(/\.html?$/i);
        const isSvg = content.mimeType === 'image/svg+xml' || filename.match(/\.svg$/i);

        if (isSvg && put) {
          const svgCode = prepareSvgForDom(fileContent);
          const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgCode, 'utf-8').toString('base64')}`;
          const result = await put(dataUrl, 'image/svg+xml', filename.endsWith('.svg') ? filename : `${filename}.svg`);
          if (result.success && result.mediaUrl) {
            return `![${artifact.title}](${result.mediaUrl})\n`;
          }
        } else if (isHtml && put) {
          const dataUrl = `data:text/html;base64,${Buffer.from(fileContent, 'utf-8').toString('base64')}`;
          const result = await put(dataUrl, 'text/html', filename.endsWith('.html') ? filename : `${filename}.html`);
          if (result.success && result.mediaUrl) {
            return `!html[${artifact.title}](${result.mediaUrl})\n`;
          }
        } else {
          // Other file types: code block
          const ext = filename.split('.').pop()?.toLowerCase() ?? '';
          const lang = ext === 'py' ? 'python' : ext === 'js' ? 'javascript' : ext === 'ts' ? 'typescript' : ext || 'text';
          return `\`\`\`${lang}\n${fileContent.trimEnd()}\n\`\`\`\n`;
        }
      }
    } catch (err) {
      console.warn('[extract-turn] local_resource download failed', { title: artifact.title, filePath: content.filePath, error: err });
    }
    return `> 📎 **${artifact.title}** — sandbox 文件（${content.filePath.split('/').pop()}）\n`;
  }

  return '';
}

/**
 * Download a file from Claude's sandbox via the wiggle API.
 * Uses the page's webContents to inject a fetch with the user's session cookies.
 */
async function downloadLocalResource(filePath: string): Promise<string | null> {
  try {
    // Try each bound webContents for a Claude page
    const { webContents: electronWebContents } = await import('electron');
    for (const wc of electronWebContents.getAllWebContents()) {
      const url = wc.getURL();
      if (!url.includes('claude.ai/chat/')) continue;
      const downloadScript = `
        (async () => {
          try {
            // Get orgId from performance entries
            const entries = performance.getEntriesByType('resource');
            let orgId = null;
            for (const entry of entries) {
              const m = entry.name.match(/claude\\.ai\\/api\\/organizations\\/([0-9a-f-]{36})/);
              if (m) { orgId = m[1]; break; }
            }
            if (!orgId) return null;

            const convMatch = window.location.href.match(/\\/chat\\/([^/?#]+)/);
            if (!convMatch) return null;
            const convId = convMatch[1];

            const apiUrl = '/api/organizations/' + orgId + '/conversations/' + convId + '/wiggle/download-file?path=' + encodeURIComponent('${filePath}');
            const resp = await fetch(apiUrl, { credentials: 'include' });
            if (!resp.ok) return null;
            const text = await resp.text();
            return text;
          } catch (e) {
            return null;
          }
        })()
      `;

      const result = await wc.executeJavaScript(downloadScript);
      if (result && typeof result === 'string' && result.length > 0) {
        return result;
      }
    }
    return null;
  } catch (err) {
    console.warn('[extract-turn] downloadLocalResource failed', { filePath, error: err });
    return null;
  }
}

async function messageToMarkdown(msg: ConversationMessage): Promise<string> {
  // Use contentParts to preserve original interleaving order
  if (msg.contentParts.length > 0) {
    const parts: string[] = [];
    for (const part of msg.contentParts) {
      if (part.type === 'text') {
        const trimmed = part.text.trim();
        if (trimmed) parts.push(trimmed);
      } else if (part.type === 'artifact') {
        const md = await artifactToMarkdown(part.artifact);
        if (md.trim()) parts.push(md.trim());
      }
    }
    return parts.join('\n\n');
  }

  // Fallback for messages without contentParts
  const parts: string[] = [];
  if (msg.textContent.trim()) {
    parts.push(msg.textContent.trim());
  }
  for (const artifact of msg.artifacts) {
    parts.push(await artifactToMarkdown(artifact));
  }
  return parts.join('\n\n');
}

// ── Public API ──

export async function extractTurn(
  pageId: string,
  msgIndex: number,
): Promise<ExtractedTurn | null> {
  const conversation = getConversationData(pageId);
  if (!conversation) {
    browserCapabilityTraceWriter.writeDebugLog(pageId, 'extract-turn', {
      msgIndex,
      error: 'no conversation data',
    });
    return null;
  }

  // DOM's resolveMsgIndex returns the position among assistant-only elements (0-based).
  // e.g. msgIndex=0 → first assistant, msgIndex=1 → second assistant, etc.
  // Conversation API uses sequential index across ALL messages (human + assistant).
  // We must use assistant-only indexing to map correctly.
  const assistantMessages = conversation.messages.filter((m) => m.sender === 'assistant');

  let assistantMsg: ConversationMessage | undefined;
  let humanMsg: ConversationMessage | null = null;

  if (msgIndex >= 0 && msgIndex < assistantMessages.length) {
    // Primary: treat msgIndex as assistant-only index (DOM ordering)
    assistantMsg = assistantMessages[msgIndex];
  } else {
    // Fallback: try as conversation API index
    assistantMsg = conversation.messages.find(
      (m) => m.index === msgIndex && m.sender === 'assistant',
    );
  }

  if (!assistantMsg) {
    browserCapabilityTraceWriter.writeDebugLog(pageId, 'extract-turn', {
      msgIndex,
      error: 'no assistant message found',
      assistantCount: assistantMessages.length,
      availableIndices: conversation.messages.map((m) => ({ index: m.index, sender: m.sender })),
    });
    return null;
  }

  // Find preceding human message
  const humanMsgs = conversation.messages.filter(
    (m) => m.sender === 'human' && m.index < assistantMsg.index,
  );
  humanMsg = humanMsgs.length > 0 ? humanMsgs[humanMsgs.length - 1] : null;

  const result: ExtractedTurn = {
    index: assistantMsg.index,
    userMessage: humanMsg?.textContent.trim() ?? '',
    markdown: await messageToMarkdown(assistantMsg),
    timestamp: assistantMsg.createdAt,
    artifactCount: assistantMsg.artifacts.length,
  };

  // Cache extraction data for debugging
  browserCapabilityTraceWriter.writeDebugLog(pageId, 'extract-turn', {
    msgIndex,
    resolvedIndex: result.index,
    userMessagePreview: result.userMessage.slice(0, 100),
    markdownLength: result.markdown.length,
    markdownPreview: result.markdown.slice(0, 800),
    markdownTail: result.markdown.slice(-200),
    artifactCount: result.artifactCount,
    artifacts: assistantMsg.artifacts.map((a) => ({
      artifactId: a.artifactId,
      title: a.title,
      kind: a.kind,
      toolName: a.toolName,
      hasContent: !!a.content,
      contentType: a.content?.type ?? null,
      contentSize: a.content?.type === 'widget_code' ? a.content.code.length
        : a.content?.type === 'file_text' ? a.content.text.length
        : a.content?.type === 'downloaded' ? a.content.byteLength
        : 0,
    })),
  });

  return result;
}

export async function extractFullConversation(
  pageId: string,
): Promise<ExtractedConversation | null> {
  clearExtractedArtifactCache();

  const conversation = getConversationData(pageId);
  if (!conversation || conversation.messages.length === 0) {
    browserCapabilityTraceWriter.writeDebugLog(pageId, 'extract-full', {
      error: conversation ? 'no messages' : 'no conversation data',
    });
    return null;
  }

  const turns: ExtractedTurn[] = [];

  for (let i = 0; i < conversation.messages.length; i++) {
    const msg = conversation.messages[i];
    if (msg.sender !== 'assistant') continue;

    // Find preceding human message
    const humanMsgs = conversation.messages.filter(
      (m) => m.sender === 'human' && m.index < msg.index,
    );
    const humanMsg = humanMsgs.length > 0 ? humanMsgs[humanMsgs.length - 1] : null;

    const markdown = await messageToMarkdown(msg);
    turns.push({
      index: msg.index,
      userMessage: humanMsg?.textContent.trim() ?? '',
      markdown,
      timestamp: msg.createdAt,
      artifactCount: msg.artifacts.length,
    });
  }

  const result: ExtractedConversation = {
    title: conversation.name || '未命名对话',
    model: conversation.model,
    turns,
  };

  // Cache full extraction data for debugging
  browserCapabilityTraceWriter.writeDebugLog(pageId, 'extract-full', {
    title: result.title,
    model: result.model,
    totalMessages: conversation.messages.length,
    totalTurns: turns.length,
    turns: turns.map((t) => ({
      index: t.index,
      userMessagePreview: t.userMessage.slice(0, 80),
      markdownLength: t.markdown.length,
      markdownPreview: t.markdown.slice(0, 300),
      artifactCount: t.artifactCount,
    })),
  });

  return result;
}
