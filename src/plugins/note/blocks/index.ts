/**
 * Block 注册入口
 *
 * 所有 Block 在此导入并注册到 BlockRegistry。
 * 新增一个 Block = 1. 创建 blocks/xxx.ts  2. 在此 import + register
 */

import { blockRegistry } from '../registry';
import { noteTitleBlock } from './note-title';
import { paragraphBlock } from './paragraph';
import { headingBlock } from './heading';
import { codeBlockBlock } from './code-block';
import { blockquoteBlock } from './blockquote';
import { horizontalRuleBlock } from './horizontal-rule';
import { bulletListBlock } from './bullet-list';
import { orderedListBlock } from './ordered-list';
import { listItemBlock } from './list-item';
import { toggleListBlock } from './toggle-list';
import { hardBreakBlock } from './hard-break';
import { taskListBlock } from './task-list';
import { taskItemBlock } from './task-item';
import { calloutBlock } from './callout';
import { imageBlock } from './image';
import { tableBlock, tableRowBlock, tableCellBlock, tableHeaderBlock } from './table';
import { noteLinkBlock } from './note-link';
import { mathBlockBlock } from './math-block';
import { mathInlineBlock } from './math-inline';
import { columnListBlock, columnBlock } from './column-list';
import { frameBlockBlock } from './frame-block';
import { audioBlockBlock } from './audio-block';
import { videoBlockBlock } from './video-block';
import { tweetBlockBlock } from './tweet-block';

export function registerAllBlocks(): void {
  // 文档级
  blockRegistry.register(noteTitleBlock);

  // 基础 Block（heading 自带 toggle 能力）
  blockRegistry.register(paragraphBlock);
  blockRegistry.register(headingBlock);

  // Heading H1/H2/H3 SlashMenu 单独注册
  blockRegistry.registerSlashItem({
    id: 'heading1', blockName: 'heading', label: 'Heading 1', icon: 'H1',
    group: 'basic', keywords: ['h1', 'heading1', 'title'], order: 1,
    attrs: { level: 1 },
  });
  blockRegistry.registerSlashItem({
    id: 'heading2', blockName: 'heading', label: 'Heading 2', icon: 'H2',
    group: 'basic', keywords: ['h2', 'heading2'], order: 2,
    attrs: { level: 2 },
  });
  blockRegistry.registerSlashItem({
    id: 'heading3', blockName: 'heading', label: 'Heading 3', icon: 'H3',
    group: 'basic', keywords: ['h3', 'heading3'], order: 3,
    attrs: { level: 3 },
  });
  blockRegistry.register(codeBlockBlock);
  blockRegistry.register(blockquoteBlock);
  blockRegistry.register(horizontalRuleBlock);

  // Inline
  blockRegistry.register(hardBreakBlock);

  // 列表 Container
  blockRegistry.register(bulletListBlock);
  blockRegistry.register(orderedListBlock);
  blockRegistry.register(listItemBlock);

  // Task List Container
  blockRegistry.register(taskListBlock);
  blockRegistry.register(taskItemBlock);

  // Toggle Container
  blockRegistry.register(toggleListBlock);

  // Callout Container
  blockRegistry.register(calloutBlock);

  // Media
  blockRegistry.register(imageBlock);

  // Table
  blockRegistry.register(tableBlock);
  blockRegistry.register(tableRowBlock);
  blockRegistry.register(tableCellBlock);
  blockRegistry.register(tableHeaderBlock);

  // Inline — noteLink + mathInline
  blockRegistry.register(noteLinkBlock);
  blockRegistry.register(mathInlineBlock);

  // Math
  blockRegistry.register(mathBlockBlock);

  // Column Layout
  blockRegistry.register(columnListBlock);
  blockRegistry.register(columnBlock);

  // Frame Block
  blockRegistry.register(frameBlockBlock);

  // Media — Audio / Video / Tweet
  blockRegistry.register(audioBlockBlock);
  blockRegistry.register(videoBlockBlock);
  blockRegistry.register(tweetBlockBlock);

  // 3 列的额外 SlashMenu 项
  blockRegistry.registerSlashItem({
    id: 'column3', blockName: 'columnList', label: '3 Columns', icon: '▥',
    group: 'layout', keywords: ['column', 'three', '三列'], order: 1,
    attrs: { columns: 3 },
  });
}
