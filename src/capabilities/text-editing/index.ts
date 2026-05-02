import type { Capability } from '@shared/ui-primitives';

/**
 * capability.text-editing — 富文本编辑能力
 *
 * 本阶段(02b-1)仅最小骨架,验证 Capability 类型契约可实例化。
 * 实质内容(schema/converters/createInstance/commands/5 大菜单注册项)
 * 由 02b-2 搬迁 ProseMirror 业务代码时填入。
 *
 * 详见总纲 § 5.4 数据契约 + § 5.9 能力清单。
 *
 * 主要消费视图(详见总纲 § 5.9):
 * - note.editor / note.thought
 * - graph.canvas 节点 label / graph.* 边 label
 * - 未来 timeline 描述
 */
export const textEditingCapability: Capability = {
  id: 'capability.text-editing',
};
