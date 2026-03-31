/**
 * Block 注册入口
 *
 * 所有 Block 在此导入并注册到 BlockRegistry。
 * 新增一个 Block = 1. 创建 blocks/xxx.ts  2. 在此 import + register
 */

import { blockRegistry } from '../registry';
import { paragraphBlock } from './paragraph';
import { headingBlock } from './heading';
import { codeBlockBlock } from './code-block';
import { blockquoteBlock } from './blockquote';
import { horizontalRuleBlock } from './horizontal-rule';

export function registerAllBlocks(): void {
  blockRegistry.register(paragraphBlock);
  blockRegistry.register(headingBlock);
  blockRegistry.register(codeBlockBlock);
  blockRegistry.register(blockquoteBlock);
  blockRegistry.register(horizontalRuleBlock);
}
