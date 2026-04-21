/**
 * Gemini Extract Turn — converts Gemini conversation data into
 * ExtractedTurn format for Note import.
 *
 * Gemini's API returns complete Markdown — no contentParts reassembly needed.
 * Main tasks: download Imagen images (main-process fetch for CORS),
 * append search groundings, handle thinking chain.
 *
 * Zero DOM/CDP — all data from batchexecute API + main-process net.fetch for images.
 */

import { net } from 'electron';
import {
  getGeminiConversationData,
  type GeminiTurn,
  type GeminiGrounding,
} from './gemini-conversation-query';
import { browserCapabilityTraceWriter } from '../persistence';
import type { ExtractedTurn, ExtractedConversation } from './extract-turn';

// Media store integration
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

// ── Image download (main-process net.fetch) ──

/**
 * Download a Gemini Imagen image via main-process net.fetch.
 *
 * Imagen images at lh3.googleusercontent.com reject all renderer-side
 * fetch approaches (CORS). Electron's main-process net.fetch has no
 * CORS layer and succeeds. URLs are short-lived, so images are
 * persisted to media store as base64.
 */
async function downloadGeminiImage(imageUrl: string): Promise<string | null> {
  try {
    const response = await net.fetch(imageUrl);
    if (!response.ok) {
      console.warn('[gemini-extract] image download failed:', imageUrl.slice(0, 80), response.status);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';
    const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;

    const put = await ensureMediaStore();
    if (put) {
      const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
      const hash = imageUrl.slice(-12).replace(/[^a-zA-Z0-9]/g, '');
      const r = await put(dataUrl, contentType, `gemini-imagen-${hash}.${ext}`);
      if (r.success && r.mediaUrl) return r.mediaUrl;
    }
    return dataUrl;
  } catch (err) {
    console.warn('[gemini-extract] image download error:', err);
    return null;
  }
}

// ── Grounding → Markdown ──

function appendGroundings(markdown: string, groundings: GeminiGrounding[]): string {
  if (groundings.length === 0) return markdown;
  const lines = ['', '', '---', '', '## 参考来源', ''];
  for (let i = 0; i < groundings.length; i++) {
    const g = groundings[i];
    lines.push(`${i + 1}. [${g.title}](${g.url})`);
  }
  return markdown + lines.join('\n');
}

// ── Turn → Markdown ──

/**
 * Convert a Gemini turn to markdown.
 *
 * Gemini's API returns complete Markdown — we just need to:
 * 1. Download and inline Imagen images
 * 2. Append search groundings
 */
async function turnToMarkdown(turn: GeminiTurn): Promise<string> {
  let markdown = turn.markdown;

  // Download Imagen images in parallel and append to markdown
  if (turn.imageUrls.length > 0) {
    const downloads = await Promise.all(
      turn.imageUrls.map(url => downloadGeminiImage(url)),
    );
    const imageParts: string[] = [];
    for (const mediaUrl of downloads) {
      if (mediaUrl) imageParts.push(`![](${mediaUrl})`);
    }
    if (imageParts.length > 0) {
      markdown += '\n\n' + imageParts.join('\n\n');
    }
  }

  // Append search groundings
  markdown = appendGroundings(markdown, turn.groundings);

  return markdown;
}

// ── Public API ──

export async function extractGeminiTurn(
  pageId: string,
  msgIndex: number,
): Promise<ExtractedTurn | null> {
  const conversation = getGeminiConversationData(pageId);
  if (!conversation) {
    browserCapabilityTraceWriter.writeDebugLog(pageId, 'gemini-extract-turn', {
      msgIndex,
      error: 'no gemini conversation data',
    });
    return null;
  }

  const turn = conversation.turns[msgIndex];
  if (!turn) {
    browserCapabilityTraceWriter.writeDebugLog(pageId, 'gemini-extract-turn', {
      msgIndex,
      error: 'turn not found',
      totalTurns: conversation.turns.length,
    });
    return null;
  }

  const markdown = await turnToMarkdown(turn);

  const result: ExtractedTurn = {
    index: turn.index,
    userMessage: turn.userMessage,
    markdown: markdown || '_[无文字内容]_',
    timestamp: turn.createdAt
      ? new Date(turn.createdAt * 1000).toISOString()
      : undefined,
    artifactCount: turn.imageUrls.length + turn.groundings.length,
  };

  browserCapabilityTraceWriter.writeDebugLog(pageId, 'gemini-extract-turn', {
    msgIndex,
    resolvedIndex: result.index,
    userMessagePreview: result.userMessage.slice(0, 100),
    markdownLength: result.markdown.length,
    imageCount: turn.imageUrls.length,
    groundingCount: turn.groundings.length,
  });

  return result;
}

export async function extractGeminiFullConversation(
  pageId: string,
): Promise<ExtractedConversation | null> {
  const conversation = getGeminiConversationData(pageId);
  if (!conversation || conversation.turns.length === 0) {
    browserCapabilityTraceWriter.writeDebugLog(pageId, 'gemini-extract-full', {
      error: conversation ? 'no turns' : 'no gemini conversation data',
    });
    return null;
  }

  const turns: ExtractedTurn[] = [];
  for (const turn of conversation.turns) {
    const markdown = await turnToMarkdown(turn);
    turns.push({
      index: turn.index,
      userMessage: turn.userMessage,
      markdown: markdown || '_[无文字内容]_',
      timestamp: turn.createdAt
        ? new Date(turn.createdAt * 1000).toISOString()
        : undefined,
      artifactCount: turn.imageUrls.length + turn.groundings.length,
    });
  }

  const result: ExtractedConversation = {
    title: '未命名对话', // Gemini doesn't provide title in hNvQHb
    turns,
  };

  browserCapabilityTraceWriter.writeDebugLog(pageId, 'gemini-extract-full', {
    totalTurns: turns.length,
    turns: turns.map(t => ({
      index: t.index,
      userMessagePreview: t.userMessage.slice(0, 80),
      markdownLength: t.markdown.length,
    })),
  });

  return result;
}
