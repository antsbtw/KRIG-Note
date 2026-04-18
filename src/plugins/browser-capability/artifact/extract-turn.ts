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
          // Ensure SVG has xmlns (required for <img> rendering as external file)
          let svgCode = content.code;
          if (!svgCode.includes('xmlns=')) {
            svgCode = svgCode.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
          }
          // Replace width="100%" with fixed width from viewBox if available
          const viewBoxMatch = svgCode.match(/viewBox="0\s+0\s+(\d+)\s+(\d+)"/);
          if (viewBoxMatch && svgCode.includes('width="100%"')) {
            svgCode = svgCode.replace('width="100%"', `width="${viewBoxMatch[1]}"`);
          }
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
  const parts: string[] = [];

  // Text content
  if (msg.textContent.trim()) {
    parts.push(msg.textContent.trim());
  }

  // Artifacts inline
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
