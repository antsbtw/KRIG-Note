import { Schema, NodeSpec } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { BlockDef, NodeViewFactory, BlockCapabilities, ActionDef, ContainerRule } from './types';

/**
 * BlockRegistry — Block 注册表
 *
 * 核心：新增一个 Block = 写一个 BlockDef + 调用 register()
 * 框架自动完成：Schema 构建、NodeView 收集、Plugin 收集、SlashMenu 生成
 */

class BlockRegistry {
  private blocks: Map<string, BlockDef> = new Map();

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

  /** 从所有 BlockDef 构建 ProseMirror Schema */
  buildSchema(): Schema {
    const nodes: Record<string, NodeSpec> = {
      // doc 和 text 是 ProseMirror 必需的基础节点
      doc: { content: 'block+' },
      text: { group: 'inline' },
    };

    for (const block of this.blocks.values()) {
      nodes[block.name] = {
        ...block.nodeSpec,
        group: block.nodeSpec.group || block.group,
      };
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

  /** 生成 SlashMenu 项（从注册表自动生成） */
  buildSlashItems(): Array<{
    id: string;
    label: string;
    icon?: string;
    group: string;
    keywords?: string[];
  }> {
    return this.getAll()
      .filter((b) => b.slashMenu != null)
      .map((b) => ({
        id: b.name,
        label: b.slashMenu!.label,
        icon: b.slashMenu!.icon,
        group: b.slashMenu!.group,
        keywords: b.slashMenu!.keywords,
      }))
      .sort((a, b) => {
        const blockA = this.blocks.get(a.id);
        const blockB = this.blocks.get(b.id);
        return (blockA?.slashMenu?.order ?? 0) - (blockB?.slashMenu?.order ?? 0);
      });
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
