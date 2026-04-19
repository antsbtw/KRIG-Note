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
    if (cleared > 0) {
      console.log(`[extract-turn] cleared ${cleared} cached SVG files before extraction`);
    }
  } catch (err) {
    console.warn('[extract-turn] failed to clear artifact cache', err);
  }
}

// ── SVG preprocessing ──

/**
 * Prepare SVG for DOM rendering:
 * 1. Add xmlns if missing
 * 2. Remove event handlers (onclick 等)
 * 3. Replace CSS variables with Claude 暗色主题的具体颜色值
 * 4. Inject <style> for CSS classes (.ts/.th/.node/.c-*)
 *
 * Claude widget_code 中的 SVG 使用 CSS 类和 CSS 变量，但这些在脱离
 * Claude 页面后无法解析。下载的 SVG 之所以能正确显示，是因为浏览器
 * 导出时自动把 computed styles 内联到了每个元素上。
 * 这里在提取端做等价的处理，让 SVG 文件自包含。
 */
function prepareSvgForDom(raw: string): string {
  let svg = raw;

  // 1. xmlns
  if (!svg.includes('xmlns=')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // 2. Remove onclick/onmouseover/etc event handler attributes.
  svg = svg.replace(/ on\w+=(?:"[^>]*>|'[^>]*>)/g, '>');
  svg = svg.split('\n').map((line) => {
    if (/ on\w+=/.test(line)) {
      return line.replace(/ on\w+=.*?(?=>)/, '');
    }
    return line;
  }).join('\n');

  // 3. Replace CSS variables with Claude dark-theme concrete values
  //    (从 Claude 页面下载的 SVG 中提取的实际 computed 颜色值)
  const cssVarMap: Record<string, string> = {
    'var(--color-border-tertiary)': 'rgba(222, 220, 209, 0.15)',
    'var(--color-border-secondary)': 'rgba(222, 220, 209, 0.3)',
    'var(--color-border-primary)': 'rgba(222, 220, 209, 0.5)',
    'var(--color-text-primary)': 'rgb(250, 249, 245)',
    'var(--color-text-secondary)': 'rgb(194, 192, 182)',
    'var(--color-text-tertiary)': 'rgb(148, 146, 137)',
    'var(--color-bg-primary)': 'rgb(43, 43, 40)',
    'var(--color-bg-secondary)': 'rgb(55, 55, 52)',
    'var(--color-bg-tertiary)': 'rgb(68, 68, 65)',
    'var(--color-background-primary)': 'rgb(43, 43, 40)',
    'var(--color-background-secondary)': 'rgb(55, 55, 52)',
    'var(--color-background-tertiary)': 'rgb(68, 68, 65)',
    'var(--text-color-primary)': 'rgb(250, 249, 245)',
    'var(--text-color-secondary)': 'rgb(194, 192, 182)',
    'var(--text-color-tertiary)': 'rgb(148, 146, 137)',
    'var(--bg-color)': 'rgb(43, 43, 40)',
    'var(--fg-color)': 'rgb(250, 249, 245)',
  };
  for (const [cssVar, value] of Object.entries(cssVarMap)) {
    while (svg.includes(cssVar)) {
      svg = svg.replace(cssVar, value);
    }
  }

  // 4. Inject <style> for Claude widget CSS classes (暗色主题)
  //    颜色值从 Claude 页面下载的 SVG 的 inline styles 中提取
  const svgOpenEnd = svg.indexOf('>', svg.indexOf('<svg'));
  if (svgOpenEnd > 0) {
    const injected = [
      `<style>`,
      `  text { font-family: "Anthropic Sans", -apple-system, system-ui, sans-serif; }`,
      `  .ts { font-size: 12px; fill: rgb(194, 192, 182); }`,
      `  .th { font-size: 14px; fill: rgb(211, 209, 199); font-weight: 500; }`,
      `  .node rect { stroke-width: 0.5; }`,
      `  .c-gray rect { fill: rgb(68, 68, 65); stroke: rgb(180, 178, 169); }`,
      `  .c-gray text { fill: rgb(180, 178, 169); }`,
      `  .c-amber rect { fill: rgb(99, 56, 6); stroke: rgb(239, 159, 39); }`,
      `  .c-amber .th { fill: rgb(250, 199, 117); }`,
      `  .c-amber .ts { fill: rgb(239, 159, 39); }`,
      `  .c-coral rect { fill: rgb(113, 43, 19); stroke: rgb(240, 153, 123); }`,
      `  .c-coral .th { fill: rgb(245, 196, 179); }`,
      `  .c-coral .ts { fill: rgb(240, 153, 123); }`,
      `  .c-teal rect { fill: rgb(8, 80, 65); stroke: rgb(93, 202, 165); }`,
      `  .c-teal .th { fill: rgb(159, 225, 203); }`,
      `  .c-teal .ts { fill: rgb(93, 202, 165); }`,
      `  .c-purple rect { fill: rgb(60, 52, 137); stroke: rgb(175, 169, 236); }`,
      `  .c-purple .th { fill: rgb(206, 203, 246); }`,
      `  .c-purple .ts { fill: rgb(175, 169, 236); }`,
      `  .c-blue rect { fill: rgb(20, 60, 120); stroke: rgb(100, 160, 240); }`,
      `  .c-blue .th { fill: rgb(180, 210, 250); }`,
      `  .c-blue .ts { fill: rgb(100, 160, 240); }`,
      `  .c-green rect { fill: rgb(15, 70, 40); stroke: rgb(80, 200, 120); }`,
      `  .c-green .th { fill: rgb(160, 230, 180); }`,
      `  .c-green .ts { fill: rgb(80, 200, 120); }`,
      `  .c-red rect { fill: rgb(100, 30, 30); stroke: rgb(230, 80, 80); }`,
      `  .c-red .th { fill: rgb(245, 170, 170); }`,
      `  .c-red .ts { fill: rgb(230, 80, 80); }`,
      `  .c-indigo rect { fill: rgb(45, 40, 120); stroke: rgb(130, 120, 220); }`,
      `  .c-indigo .th { fill: rgb(190, 185, 240); }`,
      `  .c-indigo .ts { fill: rgb(130, 120, 220); }`,
      `</style>`,
    ].join('\n');
    svg = svg.slice(0, svgOpenEnd + 1) + '\n' + injected + '\n' + svg.slice(svgOpenEnd + 1);
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
          console.log('[extract-turn] media store put result', { title: artifact.title, success: result.success, mediaUrl: result.mediaUrl });
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
        console.log('[extract-turn] html media store put result', { title: artifact.title, success: result.success, mediaUrl: result.mediaUrl });
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

    // HTML files → save to media store, render as html-block
    if (ext === 'html' || ext === 'htm') {
      try {
        const put = await ensureMediaStore();
        if (put) {
          const dataUrl = `data:text/html;base64,${Buffer.from(content.text, 'utf-8').toString('base64')}`;
          const filename = content.path.split('/').pop() || `${artifact.title}.html`;
          const result = await put(dataUrl, 'text/html', filename);
          console.log('[extract-turn] html file_text put result', { title: artifact.title, success: result.success, mediaUrl: result.mediaUrl });
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

  return '';
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

  // Find the assistant message at this index and its preceding human message
  let assistantMsg = conversation.messages.find(
    (m) => m.index === msgIndex && m.sender === 'assistant',
  );
  let humanMsg: ConversationMessage | null = null;

  if (!assistantMsg) {
    // Maybe the index points to a human message — find the next assistant
    const clickedHuman = conversation.messages.find(
      (m) => m.index === msgIndex && m.sender === 'human',
    );
    if (!clickedHuman) {
      browserCapabilityTraceWriter.writeDebugLog(pageId, 'extract-turn', {
        msgIndex,
        error: 'no message at index',
        availableIndices: conversation.messages.map((m) => ({ index: m.index, sender: m.sender })),
      });
      return null;
    }
    humanMsg = clickedHuman;
    const nextAssistant = conversation.messages.find(
      (m) => m.index > msgIndex && m.sender === 'assistant',
    );
    if (!nextAssistant) {
      browserCapabilityTraceWriter.writeDebugLog(pageId, 'extract-turn', {
        msgIndex,
        error: 'no assistant message after human',
      });
      return null;
    }
    assistantMsg = nextAssistant;
  } else {
    // Find preceding human message
    const humanMsgs = conversation.messages.filter(
      (m) => m.sender === 'human' && m.index < msgIndex,
    );
    humanMsg = humanMsgs.length > 0 ? humanMsgs[humanMsgs.length - 1] : null;
  }

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
