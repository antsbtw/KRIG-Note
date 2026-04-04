/**
 * Block 注册入口
 *
 * 三基类：TextBlock / RenderBlock / ContainerBlock
 */

import { blockRegistry } from '../registry';

// ── TextBlock ──
import { textBlockDef } from './text-block';

// ── ContainerBlock ──
import { bulletListBlock } from './bullet-list';
import { orderedListBlock } from './ordered-list';
import { taskListBlock } from './task-list';
import { blockquoteBlock } from './blockquote';
import { calloutBlock } from './callout';

export function registerAllBlocks(): void {
  // ── TextBlock ──
  blockRegistry.register(textBlockDef);

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

  // ── ContainerBlock ──
  blockRegistry.register(bulletListBlock);
  blockRegistry.register(orderedListBlock);
  blockRegistry.register(taskListBlock);
  blockRegistry.register(blockquoteBlock);
  blockRegistry.register(calloutBlock);

  // ── RenderBlock ──
  // TODO: Phase 5

  // ── Inline ──
  // TODO: Phase 2
}
