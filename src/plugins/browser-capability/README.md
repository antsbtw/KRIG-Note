# Browser Capability Layer

Browser Capability Layer 是 KRIG 的浏览器底层能力骨架。

目标：

- 统一网络拦截、页面读取、渲染抓取、交互自动化、artifact 处理与落库能力
- 作为 `web-bridge` 的演进方向，而不是一次性替换
- 为 Module 5 / WebView / Note 导入链提供稳定接口

当前阶段：

- 已建立目录结构
- 已建立第一版 TypeScript 类型与接口草案
- 尚未接入现有 `web-bridge` 具体实现

建议迁移顺序：

1. 先复用 `types/` 与顶层接口
2. 再把现有 `web-bridge` 能力逐步适配到这些接口
3. 最后再考虑目录级迁移与实现合并

