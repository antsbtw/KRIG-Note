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
import { TextSelection } from 'prosemirror-state';
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
  debug?: {
    extractionId?: string;
  };
}

/**
 * Insert a conversation turn into the ProseMirror document.
 * Creates: callout (user question) + toggle (AI answer with fully parsed content)
 * Inserts at cursor position (block boundary), falling back to end of doc.
 * Pads with blank textBlocks before and after so surrounding content keeps breathing room.
 */
export async function insertTurnIntoNote(view: EditorView, payload: AppendTurnPayload): Promise<void> {
  const { turn, source } = payload;
  const { schema } = view.state;

  const nodes: PMNode[] = [];
  const textBlockType = schema.nodes.textBlock;

  // 1. User question → callout (❓)
  if (turn.userMessage.trim()) {
    const calloutType = schema.nodes.callout;
    if (calloutType && textBlockType) {
      const userPara = textBlockType.create(null, [schema.text(turn.userMessage.trim())]);
      nodes.push(calloutType.create({ emoji: '❓' }, [userPara]));
    }
  }

  // 2. AI answer → toggle with parsed content
  if (turn.markdown.trim()) {
    const toggleType = schema.nodes.toggleList;

    if (toggleType && textBlockType) {
      const labelText = `回答 (${source.serviceName})`;
      const labelNode = textBlockType.create(null, [schema.text(labelText)]);

      const contentNodes = await parseMarkdownToNodes(schema, turn.markdown);

      if (contentNodes.length > 0) {
        nodes.push(toggleType.create({ open: true }, [labelNode, ...contentNodes]));
      } else {
        const fallback = textBlockType.create(null, [schema.text(turn.markdown.trim())]);
        nodes.push(toggleType.create({ open: true }, [labelNode, fallback]));
      }
    }
  }

  // 3. Horizontal rule separator between turns
  if (schema.nodes.horizontalRule) {
    nodes.push(schema.nodes.horizontalRule.create());
  }

  if (nodes.length === 0) return;

  const insertPos = resolveInsertPos(view);
  const tr = view.state.tr;
  tr.setMeta('ai-sync', true);

  // Absorb an empty placeholder textBlock sitting right at insertPos (the
  // default "empty paragraph" the note is seeded with, or the empty block
  // trailing a previous turn). Otherwise it would leave a visible blank
  // gap between consecutive turns.
  const afterInsert = tr.doc.nodeAt(insertPos);
  if (
    afterInsert &&
    afterInsert.type.name === 'textBlock' &&
    !afterInsert.attrs.isTitle &&
    afterInsert.content.size === 0
  ) {
    tr.delete(insertPos, insertPos + afterInsert.nodeSize);
  }

  let pos = insertPos;
  for (const node of nodes) {
    tr.insert(pos, node);
    pos += node.nodeSize;
  }
  // Move the selection to the end of the freshly inserted block so the next
  // sync turn anchors *after* this one rather than at the original cursor,
  // which would cause later turns to appear before earlier ones.
  try {
    const resolved = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
    tr.setSelection(TextSelection.near(resolved, -1));
  } catch {}
  view.dispatch(tr.scrollIntoView());

  console.log(`[SyncNote] Inserted turn #${turn.index} at pos ${insertPos}: ${nodes.length} nodes (${turn.markdown.length} chars)`);
}

/** Back-compat alias */
export const appendTurnToEditor = insertTurnIntoNote;

/**
 * Resolve a block-boundary insertion position from the current selection.
 * Prefers the end of the current top-level block; falls back to doc end.
 */
function resolveInsertPos(view: EditorView): number {
  const { selection, doc } = view.state;
  const $from = selection.$from;
  if ($from && $from.depth >= 1) {
    // End of the top-level block containing the cursor
    const topAfter = $from.after(1);
    if (topAfter > 0 && topAfter <= doc.content.size) return topAfter;
  }
  return doc.content.size;
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

    // Extract children from the doc node, skipping noteTitle
    const children: PMNode[] = [];
    pmDoc.content.forEach((child: PMNode) => {
      // Skip noteTitle nodes (textBlock with isTitle=true or first node with title text)
      if (child.type.name === 'textBlock' && child.attrs.isTitle) return;
      children.push(child);
    });

    return children;
  } catch (err) {
    console.error('[SyncNote] Failed to parse markdown:', err);
    return [];
  }
}
