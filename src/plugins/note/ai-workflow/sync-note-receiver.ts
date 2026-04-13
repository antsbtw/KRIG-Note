/**
 * SyncNote Receiver — handles 'as:append-turn' ViewMessage
 *
 * When AIWebView (in ai-sync mode) captures a completed AI response,
 * it sends an 'as:append-turn' ViewMessage to the NoteView in the right slot.
 *
 * This module converts the turn into callout (user question) + toggle (AI answer)
 * ProseMirror nodes and appends them to the editor document.
 *
 * Design doc: docs/web/AI-Workflow-Protocol-设计.md §六
 */

import type { EditorView } from 'prosemirror-view';

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
 * Creates: callout (user question) + toggle (AI answer, with parsed content inside)
 */
export function appendTurnToEditor(view: EditorView, payload: AppendTurnPayload): void {
  const { turn, source } = payload;
  const { schema } = view.state;

  // Build nodes to append
  const nodes: any[] = [];

  // 1. User question → callout block (emoji: ❓)
  if (turn.userMessage.trim()) {
    const calloutType = schema.nodes.callout;
    const textBlockType = schema.nodes.textBlock;
    if (calloutType && textBlockType) {
      const userPara = textBlockType.create(null, turn.userMessage.trim()
        ? [schema.text(turn.userMessage.trim())]
        : [],
      );
      const callout = calloutType.create({ emoji: '❓' }, [userPara]);
      nodes.push(callout);
    }
  }

  // 2. AI answer → toggle block (label shows service name)
  if (turn.markdown.trim()) {
    const toggleType = schema.nodes.toggleList;
    const textBlockType = schema.nodes.textBlock;

    if (toggleType && textBlockType) {
      // Toggle's first child is the heading/label line
      const labelText = `回答 (${source.serviceName})`;

      // Parse the markdown into PM nodes for toggle content
      // For now, use simple paragraph wrapping — the full ResultParser integration
      // will come later (it runs in main process, not renderer)
      const contentNodes = markdownToSimpleNodes(schema, turn.markdown);

      // Toggle structure: first child = label (textBlock), rest = content
      const labelNode = textBlockType.create(null, [schema.text(labelText)]);
      const toggle = toggleType.create({ open: true }, [labelNode, ...contentNodes]);
      nodes.push(toggle);
    }
  }

  // 3. Horizontal rule separator
  const hrType = schema.nodes.horizontalRule;
  if (hrType) {
    nodes.push(hrType.create());
  }

  if (nodes.length === 0) return;

  // Append to end of document
  const tr = view.state.tr;
  const endPos = tr.doc.content.size;
  for (const node of nodes) {
    tr.insert(tr.doc.content.size, node);
  }

  // Scroll to bottom
  view.dispatch(tr.scrollIntoView());
  console.log(`[SyncNote] Appended turn #${turn.index}: callout + toggle (${turn.markdown.length} chars)`);
}

/**
 * Simple markdown → ProseMirror nodes converter (renderer-side).
 * Handles basic formatting: paragraphs, code blocks, math blocks, headings, lists.
 * For full fidelity, the main process ResultParser + Atom converter should be used.
 */
function markdownToSimpleNodes(schema: any, markdown: string): any[] {
  const nodes: any[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line → skip
    if (!line.trim()) { i++; continue; }

    // Math block: $$ ... $$
    if (line.trim().startsWith('$$')) {
      const mathLines: string[] = [];
      const afterOpen = line.trim().slice(2);
      if (afterOpen.endsWith('$$') && afterOpen.length > 2) {
        // Single-line math
        mathLines.push(afterOpen.slice(0, -2).trim());
      } else {
        if (afterOpen.trim()) mathLines.push(afterOpen);
        i++;
        while (i < lines.length && !lines[i].trim().endsWith('$$')) {
          mathLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          const last = lines[i].trim().slice(0, -2).trim();
          if (last) mathLines.push(last);
        }
      }
      if (schema.nodes.mathBlock) {
        const latex = mathLines.join('\n');
        nodes.push(schema.nodes.mathBlock.create(null, latex ? [schema.text(latex)] : []));
      }
      i++; continue;
    }

    // Code block: ```
    if (line.trim().startsWith('```')) {
      const langMatch = line.trim().match(/^```(\w*)/);
      const language = langMatch?.[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      if (schema.nodes.codeBlock) {
        const code = codeLines.join('\n');
        nodes.push(schema.nodes.codeBlock.create(
          { language },
          code ? [schema.text(code)] : [],
        ));
      }
      continue;
    }

    // Heading: # ## ###
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      nodes.push(schema.nodes.textBlock.create(
        { level },
        [schema.text(headingMatch[2].trim())],
      ));
      i++; continue;
    }

    // Bullet list item: - or * or +
    if (line.match(/^\s*[-*+]\s+/)) {
      const listItems: any[] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*+]\s+/)) {
        const itemText = lines[i].replace(/^\s*[-*+]\s+/, '').trim();
        if (schema.nodes.listItem) {
          const para = schema.nodes.textBlock.create(null, parseInlineMarks(schema, itemText));
          listItems.push(schema.nodes.listItem.create(null, [para]));
        }
        i++;
      }
      if (schema.nodes.bulletList && listItems.length > 0) {
        nodes.push(schema.nodes.bulletList.create(null, listItems));
      }
      continue;
    }

    // Ordered list: 1. 2. etc
    if (line.match(/^\s*\d+\.\s+/)) {
      const listItems: any[] = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s+/)) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, '').trim();
        if (schema.nodes.listItem) {
          const para = schema.nodes.textBlock.create(null, parseInlineMarks(schema, itemText));
          listItems.push(schema.nodes.listItem.create(null, [para]));
        }
        i++;
      }
      if (schema.nodes.orderedList && listItems.length > 0) {
        nodes.push(schema.nodes.orderedList.create(null, listItems));
      }
      continue;
    }

    // Horizontal rule: --- or ***
    if (line.trim().match(/^(-{3,}|\*{3,}|_{3,})$/)) {
      if (schema.nodes.horizontalRule) {
        nodes.push(schema.nodes.horizontalRule.create());
      }
      i++; continue;
    }

    // Blockquote: > text
    if (line.match(/^>\s/)) {
      const quoteLines: string[] = [line.replace(/^>\s?/, '')];
      i++;
      while (i < lines.length && lines[i].match(/^>\s?/)) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      if (schema.nodes.blockquote) {
        const innerPara = schema.nodes.textBlock.create(null, parseInlineMarks(schema, quoteLines.join('\n').trim()));
        nodes.push(schema.nodes.blockquote.create(null, [innerPara]));
      }
      continue;
    }

    // Regular paragraph (with inline marks)
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('$$') &&
      !lines[i].trim().match(/^(-{3,}|\*{3,}|_{3,})$/) &&
      !lines[i].match(/^>\s/) &&
      !lines[i].match(/^\s*[-*+]\s+/) &&
      !lines[i].match(/^\s*\d+\.\s+/)) {
      paraLines.push(lines[i]);
      i++;
    }
    const paraText = paraLines.join('\n').trim();
    if (paraText) {
      nodes.push(schema.nodes.textBlock.create(null, parseInlineMarks(schema, paraText)));
    }
  }

  // Fallback
  if (nodes.length === 0 && markdown.trim()) {
    nodes.push(schema.nodes.textBlock.create(null, parseInlineMarks(schema, markdown.trim())));
  }

  return nodes;
}

/**
 * Parse inline Markdown marks into ProseMirror content nodes.
 * Handles: **bold**, *italic*, `code`, $math$, [link](url), ![image](url)
 */
function parseInlineMarks(schema: any, text: string): any[] {
  const result: any[] = [];
  // Regex: match **bold**, *italic*, `code`, $math$, [text](url), ![alt](url)
  const regex = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\$([^$\n]+)\$|\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIdx) {
      const before = text.slice(lastIdx, match.index);
      if (before) result.push(schema.text(before));
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Image ![alt](url) → image node if available, else text fallback
      if (schema.nodes.image) {
        result.push(schema.nodes.image.create({ src: match[2], alt: match[1] }));
      } else {
        result.push(schema.text(`[${match[1]}]`));
      }
    } else if (match[3] !== undefined && match[4] !== undefined) {
      // Link [text](url)
      if (schema.marks.link) {
        result.push(schema.text(match[3], [schema.marks.link.create({ href: match[4] })]));
      } else {
        result.push(schema.text(match[3]));
      }
    } else if (match[5] !== undefined) {
      // Inline math $...$
      if (schema.nodes.mathInline) {
        result.push(schema.nodes.mathInline.create({ latex: match[5] }));
      } else {
        result.push(schema.text(`$${match[5]}$`));
      }
    } else if (match[6] !== undefined) {
      // Bold **text**
      if (schema.marks.bold) {
        result.push(schema.text(match[6], [schema.marks.bold.create()]));
      } else {
        result.push(schema.text(match[6]));
      }
    } else if (match[7] !== undefined) {
      // Italic *text*
      if (schema.marks.italic) {
        result.push(schema.text(match[7], [schema.marks.italic.create()]));
      } else {
        result.push(schema.text(match[7]));
      }
    } else if (match[8] !== undefined) {
      // Inline code `text`
      if (schema.marks.code) {
        result.push(schema.text(match[8], [schema.marks.code.create()]));
      } else {
        result.push(schema.text(match[8]));
      }
    }

    lastIdx = match.index + match[0].length;
  }

  // Remaining text
  if (lastIdx < text.length) {
    const remaining = text.slice(lastIdx);
    if (remaining) result.push(schema.text(remaining));
  }

  // Fallback: if nothing was parsed, return plain text
  if (result.length === 0 && text) {
    result.push(schema.text(text));
  }

  return result;
}
