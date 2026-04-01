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

export function registerAllBlocks(): void {
  // 文档级
  blockRegistry.register(noteTitleBlock);

  // 基础 Block
  blockRegistry.register(paragraphBlock);
  blockRegistry.register(headingBlock);
  blockRegistry.register(codeBlockBlock);
  blockRegistry.register(blockquoteBlock);
  blockRegistry.register(horizontalRuleBlock);

  // 列表 Container
  blockRegistry.register(bulletListBlock);
  blockRegistry.register(orderedListBlock);
  blockRegistry.register(listItemBlock);
}
