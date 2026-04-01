# mathVisual — 数学可视化

> **类型**：Block（叶子，Tab Container 候选）
> **位置**：文档中任意位置
> **状态**：待实现（低优先级）

---

## 一、定义

mathVisual 是交互式数学可视化——函数绘图、参数化图形、几何构造。

和 mathBlock 的区别：
- **mathBlock** = 静态公式渲染（LaTeX → KaTeX）
- **mathVisual** = 交互式图形（函数 → 坐标系绘图）

---

## 二、重新思考

在 KRIG-Note 架构中，mathVisual 是 mathBlock 的 **Tab Container 升级**场景：

```
mathBlock [公式] [可视化]
  $f(x) = x^2$  /  [交互式函数图像]
```

不需要独立的 Block 类型——mathBlock 升级后自然包含可视化面板。

---

## 三、建议

**暂不作为独立 Block 实现。** 作为 mathBlock 的 Tab Container 升级面板。

等 mathBlock + Tab Container 动态升级都实现后，mathVisual 作为渲染型 Tab 面板接入。
