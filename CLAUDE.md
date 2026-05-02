# KRIG-Note 开发规范

## 分支策略

**main 分支是稳定分支，禁止直接在 main 上开发功能代码。**

所有开发工作必须在功能分支上进行，完成后通过 merge 合并到 main。

| 分支 | 用途 | 说明 |
|------|------|------|
| `main` | 稳定发布 | 只接受 merge，不直接 commit |
| `experiment/web-content-extractor` | ChatGPT/Gemini 多平台提取 | Stage 1-3 开发 |
| `feature/*` | 独立功能开发 | 如 canvas-block, inline-file-link |
| `fix/*` | Bug 修复 | 修复后合并到 main |

### 工作流

```
1. 从 main 创建功能分支：git checkout -b feature/xxx main
2. 在功能分支上开发和测试
3. 完成后合并到 main：git checkout main && git merge feature/xxx --no-ff
4. 如需在已有实验分支上继续：git checkout experiment/xxx && git merge main
```

## 提交规范

```
feat(scope): 新功能描述
fix(scope): 修复描述
refactor(scope): 重构描述
docs(scope): 文档描述
```

## 重构期硬规则

- L5 插件代码（`src/plugins/**`）禁止 import：`openCompanion` / `ensureCompanion` / `closeRightSlot` / `openRightSlot`
- L5 改变布局只能：`dispatch(IntentEvent)`
- L3 `WorkspaceState` 禁止新增业务字段（`activeXxxId` / `expandedXxx`），新状态走 `pluginStates`
- `src/shared/**` 禁止 import `'electron'`
- 五大交互（ContextMenu / Toolbar / Slash / Handle / FloatingToolbar）必须通过对应 Registry 注册
- ContextMenu / Toolbar / Slash / Handle / FloatingToolbar 五类交互禁止在组件内直接 `<Menu>` / `useState` 写菜单项
- **Atom 永远不携带视图特定字段**（不加 `meta.view` / `meta.canvas` / 任何 view-meta）
- 视图层（`src/plugins/**/views/**`）禁止直接 import 任何不在 `tools/lint/pure-utility-allowlist.ts` 的 npm 包
- `plugins/<X>/` 下禁建 `engine/` / `runtime/` / `lib/` 目录
- 跨插件禁止 import：`plugins/<X>/**` 不能 import `plugins/<Y>/**`

违反以上任一条 = PR 拒绝合入。详见 [docs/refactor/00-总纲.md](docs/refactor/00-总纲.md)
