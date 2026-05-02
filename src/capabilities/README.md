# Capabilities

跨视图共享的能力单元。本目录是 KRIG 重构期第一公民目录(总纲 § 4.1 / § 5)。

## 当前状态(阶段 02b-1-text-editing-skeleton)

**已有 1 个 capability(仅最小骨架)**:
- `text-editing/`(commit `256ec984`)——`textEditingCapability` 实例化,仅 id 字段;实质内容由 02b-2 填入

其他 capability(canvas-interaction / web-rendering / pdf-rendering 等)将在 02b-2 起按需进入此目录。

## 设计原则

详见 [docs/refactor/00-总纲.md](../../docs/refactor/00-总纲.md):
- § 1.3 抽象原则:外部依赖一律经 Capability 封装零例外
- § 5.4 数据契约 Capability 类型骨架(已落 src/shared/ui-primitives.ts)
- § 5.5 强约束(命名空间 + 禁套娃 + 颗粒度)
- § 5.8 视图是声明,实现都在 Capability 里

## 不在本目录的实现

- 视图(View)→ `src/plugins/<X>/views/`
- 平台 Registry → `src/renderer/ui-primitives/`
- 意图调度 → `src/main/workspace/intent-dispatcher.ts`
