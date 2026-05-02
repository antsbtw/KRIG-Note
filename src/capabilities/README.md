# Capabilities

跨视图共享的能力单元。本目录是 KRIG 重构期第一公民目录(总纲 § 4.1 / § 5)。

## 当前状态(阶段 02a-platform-skeleton)

**目录占位中**——尚无任何 capability 实质内容。

具体 capability(text-editing / web-rendering / canvas-interaction / pdf-rendering 等)
将在阶段 02b 起按需封装外部依赖逐个进入此目录。详见总纲 § 5.9 KRIG 可识别的能力清单。

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
