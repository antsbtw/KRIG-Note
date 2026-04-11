/**
 * BlockRegistry — Block 注册中心
 *
 * 所有 Block 通过 register() 注册，Registry 负责：
 * 1. 构建 ProseMirror Schema（从所有注册的 BlockDef）
 * 2. 收集 NodeView 工厂函数
 * 3. 收集 Plugin
 * 4. 提供 BlockDef 查询
 */

import { Schema, type NodeSpec, type MarkSpec } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import type { BlockDef, SlashItemDef, NodeViewFactory } from './types';
import { converterRegistry } from './converters/registry';
import { textBlockConverter } from './converters/text-block-converter';
import { bulletListConverter, orderedListConverter, taskListConverter, taskItemConverter } from './converters/list-converter';
import { codeBlockConverter, mathBlockConverter, imageConverter, videoConverter, audioConverter, tweetConverter, horizontalRuleConverter, pageAnchorConverter } from './converters/render-block-converters';
import { blockquoteConverter, calloutConverter, toggleListConverter, frameBlockConverter, tableConverter, tableRowConverter, tableCellConverter, tableHeaderConverter, columnListConverter, columnConverter } from './converters/container-converters';

class BlockRegistry {
  private blocks = new Map<string, BlockDef>();
  private slashItems: SlashItemDef[] = [];

  register(block: BlockDef): void {
    this.blocks.set(block.name, block);

    // 如果 BlockDef 自带 slashMenu，自动注册 SlashItem
    if (block.slashMenu) {
      this.slashItems.push({
        id: block.name,
        blockName: block.name,
        label: block.slashMenu.label,
        icon: block.slashMenu.icon,
        group: block.slashMenu.group,
        keywords: block.slashMenu.keywords,
        order: block.slashMenu.order,
      });
    }
  }

  registerSlashItem(item: SlashItemDef): void {
    this.slashItems.push(item);
  }

  get(name: string): BlockDef | undefined {
    return this.blocks.get(name);
  }

  getAll(): BlockDef[] {
    return Array.from(this.blocks.values());
  }

  getSlashItems(): SlashItemDef[] {
    return this.slashItems;
  }

  // ── Schema 构建 ──

  buildSchema(): Schema {
    const nodes: Record<string, NodeSpec> = {
      doc: { content: 'block+' },
      text: { group: 'inline' },
    };

    for (const block of this.blocks.values()) {
      const spec = { ...block.nodeSpec };
      // 所有 block group 节点自动注入通用 attrs
      if (spec.group === 'block') {
        spec.attrs = {
          ...(spec.attrs || {}),
          indent: spec.attrs?.indent ?? { default: 0 },
          fromPage: { default: null },  // from.pdfPage — 来源页码，用于 eBook↔Note 锚定同步
        };
      }
      nodes[block.name] = spec;
    }

    const marks: Record<string, MarkSpec> = {
      bold: {
        parseDOM: [{ tag: 'strong' }],
        toDOM() { return ['strong', 0] as const; },
      },
      italic: {
        parseDOM: [{ tag: 'em' }],
        toDOM() { return ['em', 0] as const; },
      },
      code: {
        parseDOM: [{ tag: 'code' }],
        toDOM() { return ['code', 0] as const; },
      },
      underline: {
        parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
        toDOM() { return ['u', 0] as const; },
      },
      strike: {
        parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
        toDOM() { return ['s', 0] as const; },
      },
      link: {
        attrs: { href: {}, title: { default: null } },
        inclusive: false,
        parseDOM: [{ tag: 'a[href]', getAttrs(dom: HTMLElement) {
          return { href: dom.getAttribute('href'), title: dom.getAttribute('title') };
        }}],
        toDOM(node: any) { return ['a', { href: node.attrs.href, title: node.attrs.title }, 0] as const; },
      },
      textStyle: {
        attrs: { color: { default: null } },
        parseDOM: [{ style: 'color', getAttrs: (value: string) => ({ color: value }) }],
        toDOM(mark: any) {
          return mark.attrs.color ? ['span', { style: `color: ${mark.attrs.color}` }, 0] : ['span', 0];
        },
      },
      highlight: {
        attrs: { color: { default: 'yellow' } },
        parseDOM: [{ tag: 'mark', getAttrs(dom: HTMLElement) {
          return { color: dom.getAttribute('data-color') || 'yellow' };
        }}],
        toDOM(mark: any) {
          return ['mark', { 'data-color': mark.attrs.color, style: `background-color: ${mark.attrs.color}` }, 0];
        },
      },
    };

    return new Schema({ nodes, marks });
  }

  // ── NodeView 收集 ──

  buildNodeViews(): Record<string, NodeViewFactory> {
    const views: Record<string, NodeViewFactory> = {};
    for (const block of this.blocks.values()) {
      if (block.nodeView) {
        views[block.name] = block.nodeView;
      }
    }
    return views;
  }

  // ── Plugin 收集 ──

  buildBlockPlugins(): Plugin[] {
    const plugins: Plugin[] = [];
    for (const block of this.blocks.values()) {
      if (block.plugin) {
        plugins.push(block.plugin());
      }
    }
    return plugins;
  }

  // ── Container 规则 ──

  getContainerRules(): Map<string, BlockDef['containerRule']> {
    const rules = new Map<string, BlockDef['containerRule']>();
    for (const block of this.blocks.values()) {
      if (block.containerRule) {
        rules.set(block.name, block.containerRule);
      }
    }
    return rules;
  }

  // ── Converter 注册 ──

  /** 初始化 ConverterRegistry：注册所有 Converter */
  initConverters(): void {
    // 先从 BlockDef.converter 收集（如果有挂上的话）
    converterRegistry.init(Array.from(this.blocks.values()));

    // 直接注册所有已实现的 Converter
    const converters = [
      textBlockConverter,
      bulletListConverter, orderedListConverter, taskListConverter, taskItemConverter,
      codeBlockConverter, mathBlockConverter, imageConverter,
      videoConverter, audioConverter, tweetConverter, horizontalRuleConverter, pageAnchorConverter,
      blockquoteConverter, calloutConverter, toggleListConverter, frameBlockConverter,
      tableConverter, tableRowConverter, tableCellConverter, tableHeaderConverter,
      columnListConverter, columnConverter,
    ];
    for (const c of converters) {
      converterRegistry.registerConverter(c);
    }

    console.log(`[BlockRegistry] Converters initialized: ${converters.length} registered`);
  }
}

export const blockRegistry = new BlockRegistry();
