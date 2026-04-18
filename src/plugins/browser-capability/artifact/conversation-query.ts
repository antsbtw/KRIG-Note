/**
 * Conversation Query — structured access to Claude conversation data
 * for artifact import into Note.
 *
 * Reads from trace-writer's cached conversation.json and provides:
 *   - getConversationData(): structured conversation with messages
 *   - getArtifactContent(): widget_code / file_text for a specific artifact
 */

import { browserCapabilityTraceWriter } from '../persistence';
import type { ArtifactRecord } from '../types';

// ── Public types ──

export type ConversationData = {
  uuid: string;
  name: string;
  model?: string;
  currentLeafMessageUuid?: string;
  messages: ConversationMessage[];
};

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'artifact'; artifact: MessageArtifact };

export type ConversationMessage = {
  uuid: string;
  sender: 'human' | 'assistant' | 'system';
  index: number;
  createdAt?: string;
  textContent: string;
  artifacts: MessageArtifact[];
  /** content parts in original order (text and artifacts interleaved) */
  contentParts: ContentPart[];
};

export type MessageArtifact = {
  artifactId: string;
  toolUseId: string;
  toolName: string;
  title: string;
  kind: ArtifactRecord['kind'];
  content: ArtifactContent | null;
};

export type ArtifactContent =
  | { type: 'widget_code'; code: string; mimeType: string }
  | { type: 'file_text'; text: string; path: string }
  | { type: 'downloaded'; storageRef: string; mimeType?: string; byteLength?: number };

// ── Implementation ──

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extractTextFromContent(content: unknown[]): string {
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const record = part as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text);
    }
  }
  return parts.join('\n\n');
}

function detectMimeType(code: string): string {
  if (code.includes('<svg')) return 'image/svg+xml';
  if (code.includes('<div') || code.includes('<style') || code.includes('<script')) return 'text/html';
  return 'text/html';
}

function extractArtifactsFromContent(
  content: unknown[],
  messageUuid: string,
  artifacts: ArtifactRecord[],
): MessageArtifact[] {
  const result: MessageArtifact[] = [];

  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const record = part as Record<string, unknown>;
    if (record.type !== 'tool_use') continue;

    const toolName = readString(record.name) ?? '';
    const toolUseId = readString(record.id) ?? '';
    const input = record.input && typeof record.input === 'object'
      ? record.input as Record<string, unknown>
      : null;
    if (!input) continue;

    const isShowWidget = toolName.includes('show_widget');
    const isCreateFile = toolName === 'create_file';
    const isViewFile = toolName === 'view';
    const isPresentFiles = toolName === 'present_files';
    if (!isShowWidget && !isCreateFile && !isViewFile && !isPresentFiles) continue;

    const title = readString(input.title)
      ?? readString(input.name)
      ?? (readString(input.path)?.split('/').pop() ?? null)
      ?? toolUseId;

    // Match with ArtifactRecord from trace-writer
    const matched = artifacts.find((a) =>
      a.toolUseId === toolUseId ||
      (a.messageUuid === messageUuid && a.title === title),
    );

    let artifactContent: ArtifactContent | null = null;
    const widgetCode = readString(input.widget_code);
    const fileText = readString(input.file_text);
    const filePath = readString(input.path);

    if (widgetCode) {
      artifactContent = {
        type: 'widget_code',
        code: widgetCode,
        mimeType: detectMimeType(widgetCode),
      };
    } else if (fileText && filePath) {
      artifactContent = {
        type: 'file_text',
        text: fileText,
        path: filePath,
      };
    } else if (matched?.storageRef) {
      artifactContent = {
        type: 'downloaded',
        storageRef: matched.storageRef,
        mimeType: matched.mimeType,
        byteLength: matched.byteLength,
      };
    }

    let kind: ArtifactRecord['kind'] = matched?.kind ?? 'unknown';
    if (kind === 'unknown') {
      if (isShowWidget && widgetCode?.includes('<svg')) kind = 'image';
      else if (isShowWidget) kind = 'widget';
      else if (isCreateFile) kind = 'file';
      else if (isViewFile) kind = 'file';
      else if (isPresentFiles) kind = 'file';
    }

    result.push({
      artifactId: matched?.artifactId ?? `artifact:${toolUseId}`,
      toolUseId,
      toolName,
      title,
      kind,
      content: artifactContent,
    });
  }

  return result;
}

// ── Public API ──

export function getConversationData(pageId: string): ConversationData | null {
  const raw = browserCapabilityTraceWriter.getConversationRaw(pageId);
  if (!raw) return null;

  const uuid = readString(raw.uuid);
  if (!uuid) return null;

  const chatMessages = Array.isArray(raw.chat_messages) ? raw.chat_messages : [];
  const artifacts = browserCapabilityTraceWriter.getArtifacts(pageId);

  const messages: ConversationMessage[] = [];

  for (const msg of chatMessages) {
    if (!msg || typeof msg !== 'object') continue;
    const record = msg as Record<string, unknown>;
    const msgUuid = readString(record.uuid);
    if (!msgUuid) continue;

    const sender = record.sender === 'human' ? 'human'
      : record.sender === 'assistant' ? 'assistant'
      : 'system';

    const content = Array.isArray(record.content) ? record.content : [];
    const rawText = readString(record.text);
    const textContent = rawText ?? extractTextFromContent(content);

    // Build content parts in original order and collect artifacts
    const contentParts: ContentPart[] = [];
    const msgArtifacts: MessageArtifact[] = [];

    if (sender === 'assistant' && content.length > 0) {
      // Build artifact lookup for this message
      const artifactsByToolUseId = new Map<string, MessageArtifact>();
      for (const a of extractArtifactsFromContent(content, msgUuid, artifacts)) {
        artifactsByToolUseId.set(a.toolUseId, a);
        msgArtifacts.push(a);
      }

      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const partRecord = part as Record<string, unknown>;
        if (partRecord.type === 'text') {
          const text = readString(partRecord.text);
          if (text) contentParts.push({ type: 'text', text });
        } else if (partRecord.type === 'tool_use') {
          const toolUseId = readString(partRecord.id);
          if (toolUseId) {
            const artifact = artifactsByToolUseId.get(toolUseId);
            if (artifact) {
              contentParts.push({ type: 'artifact', artifact });
            }
          }
        }
        // skip tool_result and other types
      }
    } else {
      // human / system messages — just text
      if (textContent.trim()) {
        contentParts.push({ type: 'text', text: textContent });
      }
    }

    messages.push({
      uuid: msgUuid,
      sender,
      index: typeof record.index === 'number' ? record.index : messages.length,
      createdAt: readString(record.created_at) ?? undefined,
      textContent,
      artifacts: msgArtifacts,
      contentParts,
    });
  }

  return {
    uuid,
    name: readString(raw.name) ?? '',
    model: readString(raw.model) ?? undefined,
    currentLeafMessageUuid: readString(raw.current_leaf_message_uuid) ?? undefined,
    messages,
  };
}

export function getArtifactContent(
  pageId: string,
  artifactId: string,
): ArtifactContent | null {
  const conversation = getConversationData(pageId);
  if (!conversation) return null;

  for (const msg of conversation.messages) {
    for (const artifact of msg.artifacts) {
      if (artifact.artifactId === artifactId && artifact.content) {
        return artifact.content;
      }
    }
  }

  // Fallback: check if artifact has storageRef from downloads
  const artifacts = browserCapabilityTraceWriter.getArtifacts(pageId);
  const record = artifacts.find((a) => a.artifactId === artifactId);
  if (record?.storageRef) {
    return {
      type: 'downloaded',
      storageRef: record.storageRef,
      mimeType: record.mimeType,
      byteLength: record.byteLength,
    };
  }

  return null;
}
