/**
 * Extract a single conversation turn (by message index) using
 * Browser Capability data instead of DOM simulation.
 *
 * Returns structured data that the renderer can turn into markdown
 * and send to Note via as:append-turn.
 */

import {
  getConversationData,
  type ArtifactContent,
  type ContentPart,
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

// ── SVG preprocessing ──

/**
 * Prepare SVG for rendering via <img> tag:
 * 1. Add xmlns if missing (required for external SVG files)
 * 2. Replace width="100%" with fixed width from viewBox
 * 3. Replace CSS variables with concrete color values
 * 4. Inject <style> block for Claude widget CSS classes
 * 5. Inject white background rect
 */
function prepareSvgForImgTag(raw: string): string {
  let svg = raw;

  // 1. xmlns
  if (!svg.includes('xmlns=')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // 2. Fixed width from viewBox
  const viewBoxMatch = svg.match(/viewBox=["']0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)["']/);
  const vbWidth = viewBoxMatch ? viewBoxMatch[1] : null;
  const vbHeight = viewBoxMatch ? viewBoxMatch[2] : null;
  if (vbWidth && svg.includes('width="100%"')) {
    svg = svg.replace('width="100%"', `width="${vbWidth}"`);
  }

  // 3. Replace CSS variables with light-theme concrete values
  const cssVarMap: Record<string, string> = {
    'var(--color-border-tertiary)': '#e5e5e5',
    'var(--color-border-secondary)': '#d4d4d4',
    'var(--color-border-primary)': '#a3a3a3',
    'var(--color-text-primary)': '#171717',
    'var(--color-text-secondary)': '#525252',
    'var(--color-text-tertiary)': '#737373',
    'var(--color-bg-primary)': '#ffffff',
    'var(--color-bg-secondary)': '#f5f5f5',
    'var(--color-bg-tertiary)': '#e5e5e5',
    'var(--text-color-primary)': '#171717',
    'var(--text-color-secondary)': '#525252',
    'var(--bg-color)': '#ffffff',
  };
  for (const [cssVar, value] of Object.entries(cssVarMap)) {
    while (svg.includes(cssVar)) {
      svg = svg.replace(cssVar, value);
    }
  }

  // 4. Inject <style> for Claude widget CSS classes + white background
  const svgOpenEnd = svg.indexOf('>', svg.indexOf('<svg'));
  if (svgOpenEnd > 0) {
    const bgWidth = vbWidth ?? '100%';
    const bgHeight = vbHeight ?? '100%';
    const injected = [
      `<rect width="${bgWidth}" height="${bgHeight}" fill="#ffffff" rx="8"/>`,
      `<style>`,
      `  .ts { font-size: 13px; fill: #525252; font-family: system-ui, -apple-system, sans-serif; }`,
      `  .th { font-size: 15px; fill: #171717; font-weight: 600; font-family: system-ui, -apple-system, sans-serif; }`,
      `  .node rect, .node path { stroke-width: 1.5; }`,
      `  .node text { fill: #171717; }`,
      `  .c-gray rect { fill: #f5f5f5; stroke: #d4d4d4; }`,
      `  .c-amber rect { fill: #fffbeb; stroke: #f59e0b; }`,
      `  .c-purple rect { fill: #faf5ff; stroke: #a855f7; }`,
      `  .c-teal rect { fill: #f0fdfa; stroke: #14b8a6; }`,
      `  .c-coral rect { fill: #fff7ed; stroke: #f97316; }`,
      `  .c-blue rect { fill: #eff6ff; stroke: #3b82f6; }`,
      `  .c-green rect { fill: #f0fdf4; stroke: #22c55e; }`,
      `  .c-red rect { fill: #fef2f2; stroke: #ef4444; }`,
      `  .c-indigo rect { fill: #eef2ff; stroke: #6366f1; }`,
      `  text { font-family: system-ui, -apple-system, sans-serif; }`,
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
          let svgCode = prepareSvgForImgTag(content.code);
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
    // HTML widget: render as code block
    return `\`\`\`html\n${content.code.trimEnd()}\n\`\`\`\n`;
  }

  if (content.type === 'file_text') {
    const ext = content.path.split('.').pop()?.toLowerCase() ?? '';
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
  const conversation = getConversationData(pageId);
  if (!conversation || conversation.messages.length === 0) return null;

  const turns: ExtractedTurn[] = [];

  for (let i = 0; i < conversation.messages.length; i++) {
    const msg = conversation.messages[i];
    if (msg.sender !== 'assistant') continue;

    // Find preceding human message
    const humanMsgs = conversation.messages.filter(
      (m) => m.sender === 'human' && m.index < msg.index,
    );
    const humanMsg = humanMsgs.length > 0 ? humanMsgs[humanMsgs.length - 1] : null;

    turns.push({
      index: msg.index,
      userMessage: humanMsg?.textContent.trim() ?? '',
      markdown: await messageToMarkdown(msg),
      timestamp: msg.createdAt,
      artifactCount: msg.artifacts.length,
    });
  }

  return {
    title: conversation.name || '未命名对话',
    model: conversation.model,
    turns,
  };
}
