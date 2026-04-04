/**
 * Block 注册入口
 *
 * 所有 Block 在此导入并注册到 BlockRegistry。
 * 新增一个 Block = 1. 创建 blocks/xxx.ts  2. 在此 import + register
 */

import { blockRegistry } from '../registry';

// ── TextBlock 基类 ──
import { textBlockDef } from './text-block';

// ── RenderBlock ──
import { codeBlockBlock } from './code-block';
import { imageBlock } from './image';
import { mathBlockBlock } from './math-block';
import { audioBlockBlock } from './audio-block';
import { videoBlockBlock } from './video-block';
import { tweetBlockBlock } from './tweet-block';

// ── Inline 节点 ──
import { hardBreakBlock } from './hard-break';
import { noteLinkBlock } from './note-link';
import { mathInlineBlock } from './math-inline';

// ── ContainerBlock ──
import { bulletListBlock } from './bullet-list';
import { orderedListBlock } from './ordered-list';
import { taskListBlock } from './task-list';
import { blockquoteBlock } from './blockquote';
import { calloutBlock } from './callout';
// toggleList, frameBlock — 已有 Container 实现，保持不变
import { toggleListBlock } from './toggle-list';
import { toggleHeadingBlock } from './toggle-heading';
import { frameBlockBlock } from './frame-block';

// ── 特殊结构 ──
import { tableBlock, tableRowBlock, tableCellBlock, tableHeaderBlock } from './table';
import { columnListBlock, columnBlock } from './column-list';
import { horizontalRuleBlock } from './horizontal-rule';

export function registerAllBlocks(): void {
  // ── TextBlock ──
  blockRegistry.register(textBlockDef);

  // Heading H1/H2/H3 SlashMenu（改 textBlock 的 level attr）
  blockRegistry.registerSlashItem({
    id: 'heading1', blockName: 'textBlock', label: 'Heading 1', icon: 'H1',
    group: 'basic', keywords: ['h1', 'heading1', 'title'], order: 1,
    attrs: { level: 1 },
  });
  blockRegistry.registerSlashItem({
    id: 'heading2', blockName: 'textBlock', label: 'Heading 2', icon: 'H2',
    group: 'basic', keywords: ['h2', 'heading2'], order: 2,
    attrs: { level: 2 },
  });
  blockRegistry.registerSlashItem({
    id: 'heading3', blockName: 'textBlock', label: 'Heading 3', icon: 'H3',
    group: 'basic', keywords: ['h3', 'heading3'], order: 3,
    attrs: { level: 3 },
  });

  // ── RenderBlock ──
  blockRegistry.register(codeBlockBlock);
  blockRegistry.register(imageBlock);
  blockRegistry.register(mathBlockBlock);
  blockRegistry.register(audioBlockBlock);
  blockRegistry.register(videoBlockBlock);
  blockRegistry.register(tweetBlockBlock);

  // ── Inline ──
  blockRegistry.register(hardBreakBlock);
  blockRegistry.register(noteLinkBlock);
  blockRegistry.register(mathInlineBlock);

  // ── ContainerBlock ──
  blockRegistry.register(bulletListBlock);
  blockRegistry.register(orderedListBlock);
  blockRegistry.register(taskListBlock);
  blockRegistry.register(blockquoteBlock);
  blockRegistry.register(calloutBlock);
  blockRegistry.register(toggleListBlock);
  blockRegistry.register(toggleHeadingBlock);
  blockRegistry.register(frameBlockBlock);

  // ── 特殊结构 ──
  blockRegistry.register(horizontalRuleBlock);
  blockRegistry.register(tableBlock);
  blockRegistry.register(tableRowBlock);
  blockRegistry.register(tableCellBlock);
  blockRegistry.register(tableHeaderBlock);
  blockRegistry.register(columnListBlock);
  blockRegistry.register(columnBlock);

  // ── groupType SlashMenu（toggle/frame 暂保留，待迁移到 Container 的 SlashMenu） ──
  blockRegistry.registerSlashItem({
    id: 'toggle', blockName: 'textBlock', label: 'Toggle List', icon: '▸',
    group: 'basic', keywords: ['toggle', 'fold', 'collapse', '折叠'], order: 9,
    attrs: { groupType: 'toggle', groupAttrs: { open: true } },
  });
  blockRegistry.registerSlashItem({
    id: 'frame', blockName: 'textBlock', label: 'Frame', icon: '▢',
    group: 'layout', keywords: ['frame', 'border', 'box', '彩框'], order: 1,
    attrs: { groupType: 'frame', groupAttrs: { color: '#8ab4f8' } },
  });

  // ── 额外 SlashMenu ──
  blockRegistry.registerSlashItem({
    id: 'column3', blockName: 'columnList', label: '3 Columns', icon: '▥',
    group: 'layout', keywords: ['column', 'three', '三列'], order: 2,
    attrs: { columns: 3 },
  });
  blockRegistry.registerSlashItem({
    id: 'mermaid', blockName: 'codeBlock', label: 'Mermaid Diagram', icon: '◇',
    group: 'code', keywords: ['mermaid', 'diagram', 'chart', 'flow', '流程图'], order: 1,
    attrs: { language: 'mermaid' },
  });
}
