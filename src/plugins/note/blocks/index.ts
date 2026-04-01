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

  // 列表 Container
  blockRegistry.register(bulletListBlock);
  blockRegistry.register(orderedListBlock);
  blockRegistry.register(listItemBlock);

  // Toggle Container
  blockRegistry.register(toggleListBlock);
}
