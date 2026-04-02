import { Schema, NodeSpec } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { BlockDef, NodeViewFactory, BlockCapabilities, ActionDef, ContainerRule } from './types';

/**
 * BlockRegistry — Block 注册表
 *
 * 核心：新增一个 Block = 写一个 BlockDef + 调用 register()
 * 框架自动完成：Schema 构建、NodeView 收集、Plugin 收集、SlashMenu 生成
 */

/** 额外的 SlashMenu 项（一个 Block 多个菜单项，如 heading H1/H2/H3） */
interface ExtraSlashItem {
  id: string;
  blockName: string;
  label: string;
  icon?: string;
  group: string;
  keywords?: string[];
  order?: number;
  attrs?: Record<string, unknown>;
}

class BlockRegistry {
  private blocks: Map<string, BlockDef> = new Map();
  private extraSlashItems: ExtraSlashItem[] = [];

  /** 注册一个 Block */
  register(block: BlockDef): void {
    if (this.blocks.has(block.name)) {
      console.warn(`Block '${block.name}' already registered, overwriting.`);
    }
    this.blocks.set(block.name, block);
  }

  /** 获取所有已注册的 Block */
  getAll(): BlockDef[] {
    return Array.from(this.blocks.values());
  }

  /** 获取指定 Block */
  get(name: string): BlockDef | undefined {
    return this.blocks.get(name);
  }

  /** 注册额外的 SlashMenu 项（一个 Block 多个菜单项） */
  registerSlashItem(item: ExtraSlashItem): void {
    this.extraSlashItems.push(item);
  }

  /** 从所有 BlockDef 构建 ProseMirror Schema */
  buildSchema(): Schema {
    const nodes: Record<string, NodeSpec> = {
      // doc: noteTitle 可选首子 + 正文 block
      doc: { content: 'noteTitle? block+' },
      text: { group: 'inline' },
    };

    for (const block of this.blocks.values()) {
      const spec = { ...block.nodeSpec };
      // group: 优先用 nodeSpec 中声明的，否则用 BlockDef.group
      // 空字符串 '' 表示不属于任何组（如 listItem）
      if (spec.group === undefined && block.group) {
        spec.group = block.group;
      }
      nodes[block.name] = spec;
    }

    // 基础 Mark（后续可扩展为 MarkDef 注册制）
    const marks = {
      bold: {
        parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
        toDOM() { return ['strong', 0] as const; },
      },
      italic: {
        parseDOM: [{ tag: 'em' }, { tag: 'i' }],
        toDOM() { return ['em', 0] as const; },
      },
      code: {
        parseDOM: [{ tag: 'code' }],
        toDOM() { return ['code', 0] as const; },
      },
      underline: {
        parseDOM: [{ tag: 'u' }],
        toDOM() { return ['u', 0] as const; },
      },
      strike: {
        parseDOM: [{ tag: 's' }, { tag: 'del' }],
        toDOM() { return ['del', 0] as const; },
      },
      link: {
        attrs: { href: {}, title: { default: null } },
        inclusive: false,
        parseDOM: [{ tag: 'a[href]', getAttrs(dom: HTMLElement) {
          return { href: dom.getAttribute('href'), title: dom.getAttribute('title') };
        }}],
        toDOM(node: { attrs: { href: string; title: string | null } }) {
          return ['a', { href: node.attrs.href, title: node.attrs.title }, 0] as const;
        },
      },
      textStyle: {
        attrs: { color: { default: null } },
        parseDOM: [{ tag: 'span[style*="color"]', getAttrs(dom: HTMLElement) {
          return { color: dom.style.color || null };
        }}],
        toDOM(node: { attrs: { color: string | null } }) {
          if (!node.attrs.color) return ['span', 0] as const;
          return ['span', { style: `color: ${node.attrs.color}` }, 0] as const;
        },
      },
      highlight: {
        attrs: { color: { default: 'yellow' } },
        parseDOM: [{ tag: 'mark', getAttrs(dom: HTMLElement) {
          return { color: dom.getAttribute('data-color') || dom.style.backgroundColor || 'yellow' };
        }}],
        toDOM(node: { attrs: { color: string } }) {
          const bgColors: Record<string, string> = {
            yellow: 'rgba(255, 212, 0, 0.25)',
            green: 'rgba(0, 200, 83, 0.25)',
            blue: 'rgba(74, 158, 255, 0.25)',
            red: 'rgba(255, 82, 82, 0.25)',
            purple: 'rgba(171, 71, 188, 0.25)',
          };
          const bg = bgColors[node.attrs.color] || bgColors.yellow;
          return ['mark', { 'data-color': node.attrs.color, style: `background: ${bg}; padding: 2px 0;` }, 0] as const;
        },
      },
    };

    return new Schema({ nodes, marks });
  }

  /** 收集所有 NodeView */
  buildNodeViews(): Record<string, NodeViewFactory> {
    const views: Record<string, NodeViewFactory> = {};
    for (const block of this.blocks.values()) {
      if (block.nodeView) {
        views[block.name] = block.nodeView;
      }
    }
    return views;
  }

  /** 收集所有 Block Plugin */
  buildBlockPlugins(): Plugin[] {
    const plugins: Plugin[] = [];
    for (const block of this.blocks.values()) {
      if (block.plugin) {
        plugins.push(block.plugin());
      }
    }
    return plugins;
  }

  /** 生成 SlashMenu 项（从注册表 + 额外项自动生成） */
  buildSlashItems(): Array<{
    id: string;
    blockName?: string;
    label: string;
    icon?: string;
    group: string;
    keywords?: string[];
    attrs?: Record<string, unknown>;
    order?: number;
  }> {
    // Block 注册的 SlashMenu 项
    const items = this.getAll()
      .filter((b) => b.slashMenu != null)
      .map((b) => ({
        id: b.name,
        label: b.slashMenu!.label,
        icon: b.slashMenu!.icon,
        group: b.slashMenu!.group,
        keywords: b.slashMenu!.keywords,
        order: b.slashMenu!.order,
      }));

    // 额外注册的 SlashMenu 项（如 heading H1/H2/H3）
    for (const extra of this.extraSlashItems) {
      items.push({
        id: extra.id,
        label: extra.label,
        icon: extra.icon,
        group: extra.group,
        keywords: extra.keywords,
        order: extra.order,
      });
    }

    return items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /** 获取额外 SlashMenu 项的信息（blockName + attrs） */
  getExtraSlashItem(id: string): ExtraSlashItem | undefined {
    return this.extraSlashItems.find((item) => item.id === id);
  }

  /** 获取指定 Block 的 capabilities */
  getCapabilities(name: string): BlockCapabilities | undefined {
    return this.blocks.get(name)?.capabilities;
  }

  /** 获取指定 Block 的 customActions */
  getCustomActions(name: string): ActionDef[] {
    return this.blocks.get(name)?.customActions ?? [];
  }

  /** 收集所有容器规则 */
  getContainerRules(): Record<string, ContainerRule> {
    const rules: Record<string, ContainerRule> = {};
    for (const block of this.blocks.values()) {
      if (block.containerRule) {
        rules[block.name] = block.containerRule;
      }
    }
    return rules;
  }
}

export const blockRegistry = new BlockRegistry();
