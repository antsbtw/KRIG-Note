/**
 * SyncNote Receiver — handles 'as:append-turn' ViewMessage
 *
 * Converts AI conversation turns into callout (question) + toggle (answer)
 * and appends to the NoteView editor.
 *
 * Parsing flow:
 *   Markdown → IPC ai:parse-markdown (main process: ResultParser + createAtomsFromExtracted)
 *   → Atom[] → converterRegistry.atomsToDoc() → ProseMirror nodes → insert
 *
 * Design doc: docs/web/AI-Workflow-Protocol-设计.md §六
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { converterRegistry } from '../converters/registry';

declare const viewAPI: {
  aiParseMarkdown: (markdown: string) => Promise<{ success: boolean; atoms: any[]; error?: string }>;
};

interface AppendTurnPayload {
  turn: {
    index: number;
    userMessage: string;
    markdown: string;
    timestamp: number;
  };
  source: {
    serviceId: string;
    serviceName: string;
  };
}

/**
 * Append a conversation turn to the ProseMirror document.
 * Creates: callout (user question) + toggle (AI answer with fully parsed content)
 */
export async function appendTurnToEditor(view: EditorView, payload: AppendTurnPayload): Promise<void> {
  const { turn, source } = payload;
  const { schema } = view.state;

  const nodes: PMNode[] = [];

  // 1. User question → callout (❓)
  if (turn.userMessage.trim()) {
    const calloutType = schema.nodes.callout;
    const textBlockType = schema.nodes.textBlock;
    if (calloutType && textBlockType) {
      const userPara = textBlockType.create(null, [schema.text(turn.userMessage.trim())]);
      nodes.push(calloutType.create({ emoji: '❓' }, [userPara]));
    }
  }

  // 2. AI answer → toggle with parsed content
  if (turn.markdown.trim()) {
    const toggleType = schema.nodes.toggleList;
    const textBlockType = schema.nodes.textBlock;

    if (toggleType && textBlockType) {
      const labelText = `回答 (${source.serviceName})`;
      const labelNode = textBlockType.create(null, [schema.text(labelText)]);

      // Parse markdown via main process (ResultParser + createAtomsFromExtracted)
      const contentNodes = await parseMarkdownToNodes(schema, turn.markdown);

      if (contentNodes.length > 0) {
        nodes.push(toggleType.create({ open: true }, [labelNode, ...contentNodes]));
      } else {
        // Fallback: plain text
        const fallback = textBlockType.create(null, [schema.text(turn.markdown.trim())]);
        nodes.push(toggleType.create({ open: true }, [labelNode, fallback]));
      }
    }
  }

  // 3. Horizontal rule separator
  if (schema.nodes.horizontalRule) {
    nodes.push(schema.nodes.horizontalRule.create());
  }

  if (nodes.length === 0) return;

  // Append to end of document
  const tr = view.state.tr;
  for (const node of nodes) {
    tr.insert(tr.doc.content.size, node);
  }
  view.dispatch(tr.scrollIntoView());

  console.log(`[SyncNote] Appended turn #${turn.index}: ${nodes.length} nodes (${turn.markdown.length} chars)`);
}

/**
 * Parse markdown into ProseMirror nodes via main process IPC.
 * Uses the full ResultParser + createAtomsFromExtracted pipeline,
 * then converts Atom[] → ProseMirror nodes via converterRegistry.
 */
async function parseMarkdownToNodes(schema: any, markdown: string): Promise<PMNode[]> {
  try {
    const result = await viewAPI.aiParseMarkdown(markdown);

    if (!result.success || !result.atoms || result.atoms.length === 0) {
      console.warn('[SyncNote] Parse failed or empty:', result.error);
      return [];
    }

    console.log(`[SyncNote] Parsed ${result.atoms.length} atoms from markdown`);

    // Convert Atom[] → ProseMirror Doc JSON → ProseMirror nodes
    const docJson = converterRegistry.atomsToDoc(result.atoms);

    if (!docJson || !docJson.content || docJson.content.length === 0) {
      console.warn('[SyncNote] atomsToDoc returned empty doc');
      return [];
    }

    // Parse the doc JSON into actual ProseMirror nodes
    const pmDoc = schema.nodeFromJSON(docJson);

    // Extract children from the doc node (we don't want the doc wrapper itself)
    const children: PMNode[] = [];
    pmDoc.content.forEach((child: PMNode) => {
      children.push(child);
    });

    return children;
  } catch (err) {
    console.error('[SyncNote] Failed to parse markdown:', err);
    return [];
  }
}
