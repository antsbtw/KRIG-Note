/**
 * Block 注册入口
 *
 * 所有 Block 在此导入并注册到 BlockRegistry。
 * 新增一个 Block = 1. 创建 blocks/xxx.ts  2. 在此 import + register
 */

import { blockRegistry } from '../registry';

// ── 基类 ──
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

// ── 特殊结构（保持 ProseMirror 原生嵌套） ──
import { tableBlock, tableRowBlock, tableCellBlock, tableHeaderBlock } from './table';
import { columnListBlock, columnBlock } from './column-list';
import { horizontalRuleBlock } from './horizontal-rule';

// ── 旧容器已删除，由 groupType 替代 ──

export function registerAllBlocks(): void {
  // ── TextBlock 基类（替代旧的 paragraph + heading + noteTitle） ──
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

  // ── 特殊结构 ──
  blockRegistry.register(horizontalRuleBlock);
  blockRegistry.register(tableBlock);
  blockRegistry.register(tableRowBlock);
  blockRegistry.register(tableCellBlock);
  blockRegistry.register(tableHeaderBlock);
  blockRegistry.register(columnListBlock);
  blockRegistry.register(columnBlock);

  // ── 旧容器已由 groupType 替代 ──

  // ── groupType SlashMenu（设置当前 textBlock 的 groupType） ──
  blockRegistry.registerSlashItem({
    id: 'bullet', blockName: 'textBlock', label: 'Bullet List', icon: '•',
    group: 'basic', keywords: ['list', 'bullet', 'ul', 'unordered', '无序'], order: 5,
    attrs: { groupType: 'bullet' },
  });
  blockRegistry.registerSlashItem({
    id: 'ordered', blockName: 'textBlock', label: 'Numbered List', icon: '1.',
    group: 'basic', keywords: ['list', 'numbered', 'ol', 'ordered', '有序'], order: 6,
    attrs: { groupType: 'ordered' },
  });
  blockRegistry.registerSlashItem({
    id: 'task', blockName: 'textBlock', label: 'Task List', icon: '☐',
    group: 'basic', keywords: ['task', 'todo', 'checkbox', 'checklist', '待办'], order: 7,
    attrs: { groupType: 'task', groupAttrs: { checked: false } },
  });
  blockRegistry.registerSlashItem({
    id: 'callout', blockName: 'textBlock', label: 'Callout', icon: '💡',
    group: 'basic', keywords: ['callout', 'note', 'warning', 'tip', '提示'], order: 11,
    attrs: { groupType: 'callout', groupAttrs: { emoji: '💡' } },
  });
  blockRegistry.registerSlashItem({
    id: 'quote', blockName: 'textBlock', label: 'Quote', icon: '❝',
    group: 'basic', keywords: ['quote', 'blockquote', '引用'], order: 8,
    attrs: { groupType: 'quote' },
  });
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
