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

- [Artifact-Import-设计.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/docs/web/browser-capability/Artifact-Import-设计.md)
  基于 Browser Capability artifact 识别的 Note 导入设计：单条提取替代 + 整页提取新功能。

## 推荐阅读顺序

1. 先读“设计”
2. 再读“实施任务清单”
3. 最后读“测试方案”

## 当前状态

- 文档已独立归档
- `src/plugins/browser-capability/` 已从“代码骨架”推进到“可运行的 capability layer 第一版”
- per-page trace 已稳定落盘到 `debug/browser-capability-traces/<runId>/`
- Claude 样本页已经验证通了：
  - 生命周期 / page registry / trace
  - network capture / response body capture
  - `responses/` 与 `extracted/` 输出
  - `conversation.json`
  - `artifacts.json`
  - `downloads.json`
  - `frames.json`
  - `anchors.json`
  - `interactions.json`

## 当前进度

| 能力项 | 当前状态 | 说明 |
| --- | --- | --- |
| 生命周期 / 页面注册 | 已完成第一版 | per-page trace、page state、lease 主链已工作 |
| Network Capture | 已完成第一版 | canonical request 关联、body capture、下载事件已接通 |
| Response Body Provider | 已完成第一版 | 现已支持 provider 抽象，当前以现有实现验证 |
| 通用 extracted 落盘 | 已完成第一版 | `responses/` 与 `pages/<pageId>/extracted/` 已稳定输出 |
| Claude conversation 提取 | 已完成 | `conversation.json` 已能落盘并参与语义回补 |
| Artifact 发现与合并 | 已完成第一版 | 支持 discovered/downloaded、消息语义、历史回补 |
| Frame / iframe 归属 | 已完成第一版 | 已能定位到具体 `claudemcpcontent.com` subframe |
| 页面 anchors | 已完成第一版 | 已输出 iframe anchor、rect、visible、textPreview |
| 页面 interactions | 已完成第一版 | 已输出可操作 surface，并做初步分层 |
| Interaction -> Artifact 关联 | 已完成第一版 | Claude 样本中已能回填 `artifactId/anchorId/frameId` |

## 最近验证结果

- Claude 页面已验证出完整对象链：
  - `artifact -> frame -> domAnchor -> interaction -> download/meta`
- `physical_laws_basic_facts` 已能同时保留：
  - `messageUuid`
  - `toolUseId`
  - `frameId/frameUrl/frameKind`
  - `domAnchorId`
  - `byteLength/sha256/extension/mtime`
- artifact 附近的交互项已能挂回：
  - `artifactId`
  - `anchorId`
  - `frameId`

## 下一步

1. 把这套闭环从 Claude 样本推广到更通用的 iframe / embed 页面。
2. 继续收敛 `interactions.json` 的噪声与分层规则。
3. 将当前轻量 runtime 扫描抽象成更正式的 runtime bridge。
4. 开始补 `render / rect / frame capture` 的系统化实现与验证。
