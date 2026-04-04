/**
 * Block 注册入口 — 三基类架构
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

// ── RenderBlock ──
import { codeBlockBlock } from './code-block';
import { mathBlockBlock } from './math-block';
import { imageBlock } from './image';
import { videoBlockBlock } from './video-block';
import { audioBlockBlock } from './audio-block';
import { tweetBlockBlock } from './tweet-block';

// ── Inline ──
import { hardBreakBlock } from './hard-break';

// ── 特殊 ──
import { horizontalRuleBlock } from './horizontal-rule';

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
  blockRegistry.register(blockquoteBlock);
  blockRegistry.register(calloutBlock);

  // ── RenderBlock ──
  blockRegistry.register(codeBlockBlock);
  blockRegistry.register(mathBlockBlock);
  blockRegistry.register(imageBlock);
  blockRegistry.register(videoBlockBlock);
  blockRegistry.register(audioBlockBlock);
  blockRegistry.register(tweetBlockBlock);

  // ── Inline ──
  blockRegistry.register(hardBreakBlock);

  // ── 特殊 ──
  blockRegistry.register(horizontalRuleBlock);
}
