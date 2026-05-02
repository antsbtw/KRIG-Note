import type { Capability } from '@shared/ui-primitives';

/**
 * capability.text-editing — 富文本编辑能力
 *
 * 阶段 02b-2a 升级:从 02b-1 仅 id 字段升级到含字段占位形态。
 * 各字段填充时机:
 * - schema:02b-2b 搬迁 PM Schema(来自 note/registry.ts)后填实例
 * - converters:02b-2b 搬迁 converterRegistry 后填 ConverterPair 适配器
 * - createInstance:02b-2d 搬迁 NoteEditor 入口后填实例工厂
 * - commands:02b-2c 搬迁 commands/ 后填命令实现
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

  // schema:02b-2b 填(搬迁 note/registry.ts BlockRegistry 内的 PM Schema 实例)
  schema: undefined,

  // converters:02b-2b 填(搬迁 converterRegistry 单例 + 22 个 converter 后填 ConverterPair 适配器)
  converters: undefined,

  // createInstance:02b-2d 填(搬迁 NoteEditor.tsx 入口 + 9 个 PM runtime import 后填实例工厂)
  createInstance: undefined,

  // commands:02b-2c 填(搬迁 commands/ 7 文件 + plugins/ 17 文件后填命令实现)
  commands: undefined,
};
