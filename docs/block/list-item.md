# ListItem — 列表项（已废弃）

> **状态**：❌ 已废弃（被 TextBlock groupType 系统取代）
> **替代方案**：`textBlock { groupType: 'bullet' | 'ordered' | 'task' }`

---

## 一、废弃说明

在旧设计中，listItem 是 bulletList/orderedList 的子 Container 节点（`content: 'paragraph block*'`）。

当前实现已迁移到 **TextBlock groupType 统一模型**：

- 列表项不再是独立的 Container 节点
- 每个列表项就是一个 `textBlock { groupType: 'bullet' | 'ordered' | 'task' }`
- 多个连续同 groupType 的 textBlock 在视觉上组成一个列表
- 嵌套通过 indent 层级 + groupType 切换实现

---

## 二、迁移对照

| 旧设计 | 当前实现 |
|--------|---------|
| `bulletList > listItem > paragraph` | `textBlock { groupType: 'bullet' }` |
| `orderedList > listItem > paragraph` | `textBlock { groupType: 'ordered' }` |
| `listItem { checked }` | `textBlock { groupType: 'task', groupAttrs: { checked } }` |
| listItem 内嵌套子列表 | indent + groupType 切换 |
| listItem 内嵌套任意 block | indent + SlashMenu 插入其他 block（设计中） |

---

## 三、优势

1. **一种节点类型**：所有列表项都是 textBlock，共享同一套操作逻辑
2. **无容器嵌套**：不需要 bulletList > listItem > paragraph 三层结构
3. **转换简单**：bullet ↔ ordered 只是改 groupType attr
4. **与其他 block 平等**：列表项和 paragraph、heading 同级，可以自由混排

---

## 四、参考文档

- [TextBlock 基类](base/text-block.md) — groupType 系统完整说明
- [Bullet List](bullet-list.md) — 无序列表当前实现
- [Ordered List](ordered-list.md) — 有序列表当前实现
