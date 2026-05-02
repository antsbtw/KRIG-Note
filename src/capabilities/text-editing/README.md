# capability.text-editing

富文本编辑能力(基于 ProseMirror)。详见总纲 § 5.9 能力清单 + § 5.4 数据契约。

## 当前状态(阶段 02b-1-text-editing-skeleton)

**仅最小骨架**:`textEditingCapability` 已实例化但仅含 `id` 字段。其他字段(5 大菜单 / schema / converters / createInstance / commands)**待 02b-2 填入**——届时搬迁 ProseMirror 69 文件(note 66 + graph 3)的核心代码进入本目录。

## 设计原则(总纲引用)

- § 1.3 规则 A:外部依赖必须经 Capability 封装,视图禁止直接 import
- § 5.4 数据契约:Capability 接口含 schema / converters / createInstance / commands 等字段
- § 5.5 强约束:命名空间 `capability.<name>`、禁套娃、颗粒度按"未来可扩展"
- § 5.8 视图是声明,实现都在 Capability 里——ProseMirror 是外部依赖,封装在本目录内

## 主要消费视图(预期)

- `note.editor`(完整笔记编辑器)
- `note.thought`(思考片段编辑器)
- `graph.canvas` 节点 label / `graph.*` 边 label
- 未来 `timeline.*` 描述等

## 02b-2 之后的目录结构(预期)

```
src/capabilities/text-editing/
├─ index.ts                     # textEditingCapability 完整定义
├─ README.md                    # 本文件
├─ schema.ts                    # PM block/mark 定义
├─ converters/                  # atom ↔ pm doc 双向转换
├─ commands/                    # bold/italic/link/... 命令实现
├─ plugins/                     # PM plugin 集合
├─ menu-contributions.ts        # ContextMenu/FloatingToolbar/Slash 项
└─ instance.ts                  # createInstance(host, options) 工厂
```

本阶段(02b-1)**不创建**任何上述子目录或文件——02b-2 才搬迁。
