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
  | { type: 'downloaded'; storageRef: string; mimeType?: string; byteLength?: number }
  | { type: 'local_resource'; filePath: string; mimeType: string; name: string; uuid?: string };

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

/**
 * Extract local_resource entries from tool_result content.
 * These represent files created by bash_tool in Claude's sandbox.
 */
function extractLocalResources(content: unknown[]): Array<{
  filePath: string;
  name: string;
  mimeType: string;
  uuid?: string;
  toolUseId?: string;
}> {
  const resources: Array<{ filePath: string; name: string; mimeType: string; uuid?: string; toolUseId?: string }> = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const record = part as Record<string, unknown>;
    if (record.type !== 'tool_result') continue;

    const toolUseId = readString(record.tool_use_id) ?? undefined;
    const inner = Array.isArray(record.content) ? record.content : [];
    for (const item of inner) {
      if (!item || typeof item !== 'object') continue;
      const res = item as Record<string, unknown>;
      if (res.type !== 'local_resource') continue;
      const filePath = readString(res.file_path);
      if (!filePath) continue;
      resources.push({
        filePath,
        name: readString(res.name) ?? filePath.split('/').pop() ?? 'file',
        mimeType: readString(res.mime_type) ?? 'application/octet-stream',
        uuid: readString(res.uuid) ?? undefined,
        toolUseId,
      });
    }
  }
  return resources;
}

function classifyLocalResourceKind(mimeType: string, filePath: string): ArtifactRecord['kind'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'text/html' || filePath.match(/\.html?$/i)) return 'widget';
  if (mimeType.includes('svg')) return 'image';
  if (mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('typescript')) return 'code';
  if (mimeType.includes('csv')) return 'table';
  return 'file';
}

function extractArtifactsFromContent(
  content: unknown[],
  messageUuid: string,
  artifacts: ArtifactRecord[],
): MessageArtifact[] {
  const result: MessageArtifact[] = [];
  const skippedToolUseIds = new Set<string>();

  // Collect local_resource entries from tool_result (bash_tool output)
  const localResources = extractLocalResources(content);

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
    const isBashTool = toolName === 'bash_tool';

    // Skip tools that don't produce artifacts
    if (!isShowWidget && !isCreateFile && !isViewFile && !isPresentFiles && !isBashTool) continue;

    const pathSegment = readString(input.path)?.split('/').pop();
    const title = readString(input.title)
      ?? readString(input.name)
      ?? pathSegment
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

    // For bash_tool: skip if no local_resource associated with this tool
    if (isBashTool && !artifactContent) {
      // Don't push bash_tool itself as an artifact — its output files
      // will be pushed via local_resource below
      continue;
    }

    // For view: improve title
    if (isViewFile && filePath) {
      result.push({
        artifactId: matched?.artifactId ?? `artifact:${toolUseId}`,
        toolUseId,
        toolName,
        title: filePath.split('/').pop() ?? title,
        kind: 'file',
        content: artifactContent,
      });
      continue;
    }

    // For present_files: use local_resource from tool_result as content.
    // Skip if the same file was already created by a preceding create_file in this message.
    if (isPresentFiles) {
      const filepathsToCheck = Array.isArray(input.filepaths) ? input.filepaths : [];
      const alreadyCreated = filepathsToCheck.length > 0 && filepathsToCheck.every((fp: unknown) => {
        if (typeof fp !== 'string') return false;
        const fname = fp.split('/').pop();
        return result.some(r => r.toolName === 'create_file' && r.content?.type === 'file_text'
          && (r.content as any).path?.split('/').pop() === fname);
      });
      if (alreadyCreated) {
        skippedToolUseIds.add(toolUseId);
        continue;
      }
      const filepaths = Array.isArray(input.filepaths) ? input.filepaths : [];
      const fileNames = filepaths
        .map((fp: unknown) => typeof fp === 'string' ? fp.split('/').pop() : null)
        .filter((n: unknown): n is string => typeof n === 'string');

      // Find associated local_resource (from the tool_result of this present_files call)
      const associatedResource = localResources.find((r) => r.toolUseId === toolUseId);
      let presentContent: ArtifactContent | null = artifactContent;
      if (!presentContent && associatedResource) {
        const resMatched = artifacts.find((a) =>
          a.title === associatedResource.name ||
          a.title === associatedResource.filePath.split('/').pop(),
        );
        if (resMatched?.storageRef) {
          presentContent = {
            type: 'downloaded',
            storageRef: resMatched.storageRef,
            mimeType: resMatched.mimeType,
            byteLength: resMatched.byteLength,
          };
        } else {
          presentContent = {
            type: 'local_resource',
            filePath: associatedResource.filePath,
            mimeType: associatedResource.mimeType,
            name: associatedResource.name,
            uuid: associatedResource.uuid,
          };
        }
      }

      // Create one artifact per local_resource file, or one for the whole present_files
      const resourcesForThis = localResources.filter((r) => r.toolUseId === toolUseId);
      if (resourcesForThis.length > 0) {
        for (const res of resourcesForThis) {
          const resMatched = artifacts.find((a) =>
            a.title === res.name || a.title === res.filePath.split('/').pop(),
          );
          const resContent: ArtifactContent = resMatched?.storageRef
            ? { type: 'downloaded', storageRef: resMatched.storageRef, mimeType: resMatched.mimeType, byteLength: resMatched.byteLength }
            : { type: 'local_resource', filePath: res.filePath, mimeType: res.mimeType, name: res.name, uuid: res.uuid };
          result.push({
            artifactId: resMatched?.artifactId ?? `artifact:local:${res.name}`,
            toolUseId,
            toolName,
            title: res.name,
            kind: classifyLocalResourceKind(res.mimeType, res.filePath),
            content: resContent,
          });
        }
      } else {
        result.push({
          artifactId: matched?.artifactId ?? `artifact:${toolUseId}`,
          toolUseId,
          toolName,
          title: fileNames.length > 0 ? fileNames.join(', ') : title,
          kind: 'file',
          content: presentContent,
        });
      }
      continue;
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

  // Add local_resource entries that aren't already covered by tool_use artifacts
  const coveredToolUseIds = new Set(result.map((a) => a.toolUseId));
  for (const res of localResources) {
    // Skip if this resource's tool_use is already represented or was skipped (deduped)
    if (res.toolUseId && (coveredToolUseIds.has(res.toolUseId) || skippedToolUseIds.has(res.toolUseId))) continue;

    // Check if already matched by download event
    const matched = artifacts.find((a) =>
      a.title === res.name ||
      a.title === res.filePath.split('/').pop(),
    );

    let content: ArtifactContent | null = null;
    if (matched?.storageRef) {
      content = {
        type: 'downloaded',
        storageRef: matched.storageRef,
        mimeType: matched.mimeType,
        byteLength: matched.byteLength,
      };
    } else {
      // File not yet downloaded — record as local_resource for proactive download
      content = {
        type: 'local_resource',
        filePath: res.filePath,
        mimeType: res.mimeType,
        name: res.name,
        uuid: res.uuid,
      };
    }

    result.push({
      artifactId: matched?.artifactId ?? `artifact:local:${res.name}`,
      toolUseId: res.toolUseId ?? '',
      toolName: 'bash_tool',
      title: res.name,
      kind: classifyLocalResourceKind(res.mimeType, res.filePath),
      content,
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
