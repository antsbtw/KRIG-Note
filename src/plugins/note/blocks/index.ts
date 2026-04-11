/**
 * Block 注册入口 — 三基类架构
 */

import { blockRegistry } from '../registry';

// ── TextBlock ──
import { textBlockDef } from './text-block';

// ── ContainerBlock ──
import { bulletListBlock } from './bullet-list';
import { orderedListBlock } from './ordered-list';
import { taskListBlock, taskItemBlock } from './task-list';
import { blockquoteBlock } from './blockquote';
import { calloutBlock } from './callout';
import { toggleListBlock } from './toggle-list';
import { frameBlockBlock } from './frame-block';
import { tableBlock, tableRowBlock, tableCellBlock, tableHeaderBlock } from './table';
import { columnListBlock, columnBlock } from './column-list';

// ── RenderBlock ──
import { codeBlockBlock } from './code-block';
import { mathBlockBlock } from './math-block';
import { imageBlock } from './image';
import { videoBlockBlock } from './video-block';
import { audioBlockBlock } from './audio-block';
import { tweetBlockBlock } from './tweet-block';
import { mathVisualBlock } from './math-visual';

// ── Inline ──
import { hardBreakBlock } from './hard-break';
import { mathInlineBlock } from './math-inline';

// ── 特殊 ──
import { horizontalRuleBlock } from './horizontal-rule';
import { pageAnchorBlock } from './page-anchor';

export function registerAllBlocks(): void {
  // ── TextBlock ──
  blockRegistry.register(textBlockDef);
  blockRegistry.registerSlashItem({
    id: 'heading1', blockName: 'textBlock', label: 'Heading 1', icon: 'H1',
    group: 'basic', keywords: ['h1', 'heading1', 'title'], order: 1, attrs: { level: 1 },
  });
  blockRegistry.registerSlashItem({
    id: 'heading2', blockName: 'textBlock', label: 'Heading 2', icon: 'H2',
    group: 'basic', keywords: ['h2', 'heading2'], order: 2, attrs: { level: 2 },
  });
  blockRegistry.registerSlashItem({
    id: 'heading3', blockName: 'textBlock', label: 'Heading 3', icon: 'H3',
    group: 'basic', keywords: ['h3', 'heading3'], order: 3, attrs: { level: 3 },
  });

  // ── ContainerBlock ──
  blockRegistry.register(bulletListBlock);
  blockRegistry.register(orderedListBlock);
  blockRegistry.register(taskListBlock);
  blockRegistry.register(taskItemBlock);
  blockRegistry.register(blockquoteBlock);
  blockRegistry.register(calloutBlock);
  blockRegistry.register(toggleListBlock);
  blockRegistry.register(frameBlockBlock);
  blockRegistry.register(tableBlock);
  blockRegistry.register(tableRowBlock);
  blockRegistry.register(tableCellBlock);
  blockRegistry.register(tableHeaderBlock);
  blockRegistry.register(columnListBlock);
  blockRegistry.register(columnBlock);

  // ── RenderBlock ──
  blockRegistry.register(codeBlockBlock);
  blockRegistry.register(mathBlockBlock);
  blockRegistry.register(imageBlock);
  blockRegistry.register(videoBlockBlock);
  blockRegistry.register(audioBlockBlock);
  blockRegistry.register(tweetBlockBlock);
  blockRegistry.register(mathVisualBlock);

  // ── Inline ──
  blockRegistry.register(hardBreakBlock);
  blockRegistry.register(mathInlineBlock);

  // ── 特殊 ──
  blockRegistry.register(horizontalRuleBlock);
  blockRegistry.register(pageAnchorBlock);

  // ── 额外 SlashMenu ──
  blockRegistry.registerSlashItem({
    id: 'column3', blockName: 'columnList', label: '3 Columns', icon: '▥',
    group: 'layout', keywords: ['column', 'three', '三列'], order: 3, attrs: { columns: 3 },
  });
  blockRegistry.registerSlashItem({
    id: 'mermaid', blockName: 'codeBlock', label: 'Mermaid Diagram', icon: '◇',
    group: 'code', keywords: ['mermaid', 'diagram', 'flow', '流程图'], order: 1, attrs: { language: 'mermaid' },
  });
}
