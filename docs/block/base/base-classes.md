# Block 基类定义

> **文档类型**：架构契约索引
> **状态**：草案 v1 | 创建日期：2026-04-03
>
> **本文档目的**：定义 Block 继承体系和共享能力。两个基类的详细契约见独立文档。

---

## 一、继承体系

```
Block（抽象基类）
  ├── TextBlock  — inline 流（文字 + inline 节点混排）
  │     详细契约：text-block.md
  │
  └── RenderBlock — 独立运行容器（注册渲染器）
        详细契约：render-block.md
```

所有具体 Block 必须继承其中一个基类，不允许跳过基类直接实现。

---

## 二、Block 抽象基类：共享 Attrs

所有 Block（无论 TextBlock 还是 RenderBlock）共享以下 attrs：

```typescript
interface BlockBaseAttrs {
  // ── 排版 ──
  indent: number;              // 缩进级别（0-8），Tab/Shift-Tab
  textIndent: boolean;         // 首行缩进（CSS text-indent: 2em）
  align: 'left' | 'center' | 'right' | 'justify';  // 文本对齐

  // ── 组合 ──
  groupType: string | null;    // 组合类型
  groupAttrs: Record<string, unknown> | null;  // 组合专属属性
}
```

---

## 三、Block 抽象基类：共享操作

| 操作 | 入口 | 行为 |
|------|------|------|
| Handle 显示 | 鼠标靠近 Block | 显示 + 和 ⠿ 按钮 |
| + 新建 | Handle + 按钮 | 在下方创建同类 Block |
| 拖拽移动 | Handle ⠿ 拖拽 | 移动 Block 位置 |
| 菜单 | Handle ⠿ 点击 | 弹出操作菜单 |
| 删除 | HandleMenu / ContextMenu / Backspace | 删除 Block |
| Block Selection | ESC | 选中当前 Block |
| 多选 | Shift+↑↓ | 扩展选中范围 |
| 复制/剪切 | Cmd+C/X（选中状态） | Block 级操作 |
| 粘贴 | Cmd+V | Block 级粘贴 |
| Undo/Redo | Cmd+Z / Cmd+Shift+Z | 撤销/重做 |
| 缩进 | Tab / Shift+Tab | indent ±1 |
| 组合 | groupType | 参与视觉容器 |

---

## 四、约束

1. **必须继承基类**——不允许绕过基类直接创建 Block 类型
2. **基类行为不可覆盖**——Handle、拖拽、删除、选中等操作，子类不能修改
3. **扩展在子类侧**——TextBlock 通过 inline 节点/mark 扩展，RenderBlock 通过注册 renderer 扩展
4. **groupType 所有 Block 通用**——TextBlock 和 RenderBlock 都可以参与视觉容器
5. **回车 = 新 Block**——没有例外

---

## 五、详细契约

- **TextBlock**：`text-block.md` — inline 流、marks、level、键盘行为、FloatingToolbar
- **RenderBlock**：`render-block.md` — 注册制、renderer 接口、Toolbar 规范、升级路径

---

*修改基类行为需要全体评审。*
