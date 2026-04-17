# Browser Capability Layer 文档索引

本目录用于集中存放 KRIG Browser Capability Layer 的独立设计文档，避免与现有 Web/AI 提取问题文档混淆。

## 文档列表

- [KRIG-Browser-Capability-Layer-设计.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/docs/web/browser-capability/KRIG-Browser-Capability-Layer-设计.md)
  说明 Browser Capability Layer 的目标、分层、目录结构与第一版接口草案。

- [KRIG-Browser-Capability-Layer-实施任务清单.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/docs/web/browser-capability/KRIG-Browser-Capability-Layer-实施任务清单.md)
  将设计文档拆解为可执行的实现阶段、任务项、里程碑和建议顺序。

- [KRIG-Browser-Capability-Layer-测试方案.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/docs/web/browser-capability/KRIG-Browser-Capability-Layer-测试方案.md)
  定义 Browser Capability Layer 的测试目标、测试模块、夹具策略和比对方法。

- [Defuddle-vs-Browser-Capability-对比分析.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/docs/web/browser-capability/Defuddle-vs-Browser-Capability-对比分析.md)
  Defuddle（mirro-desktop 生产实现）与 Browser Capability Layer 的逐能力对比、差异分析和整合建议。

## 推荐阅读顺序

1. 先读“设计”
2. 再读“实施任务清单”
3. 最后读“测试方案”

## 当前状态

- 文档已独立归档
- 代码骨架已建立：`src/plugins/browser-capability/`
- 具体实现尚未开始迁移现有 `web-bridge`

