# translationBlock — 翻译块

> **类型**：Container（block+ 子节点）
> **位置**：文档中任意位置
> **状态**：待实现，考虑用 Tab Container 替代

---

## 一、定义

translationBlock 是翻译内容容器——存放从外语翻译的内容。

---

## 二、重新思考

在 KRIG-Note 的架构中，translationBlock 可能**不需要作为独立 Block**——翻译是 paragraph 的 **Tab Container 升级**场景：

```
paragraph [原文] [翻译]
原文内容...
Translation content...
```

每个 paragraph/heading 都可以动态升级为包含翻译面板的 Tab Container。这比专门的 translationBlock 更灵活——不限于翻译场景，任何"多版本文本"都可以用同样的机制。

---

## 三、建议

**不单独实现 translationBlock**。翻译能力通过 Tab Container 动态升级实现：

1. 用户选中 paragraph → 操作"翻译" → paragraph 升级为 Tab Container
2. 添加翻译面板（editable tabPane）
3. 翻译内容填入翻译面板

这符合"一生二、二生三"的原则——不为每个功能创建新 Block，而是通过通用机制（Tab Container）组合出来。

---

## 四、状态

**暂不实现。** 等 Tab Container 动态升级机制完善后，翻译功能自然可用。
