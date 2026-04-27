# KRIG Graph · Layer 2 内容填充 Vision（框架文件）

> Layer 2 Vision v0.1 · 2026-04-28（框架占位，未展开）
>
> 作者：wenwu + Claude
>
> 本文件是 [KRIG-Note 愿景](../KRIG-Note-Vision.md) 三层架构里 **Layer 2** 的占位 spec。
>
> 主要章节为框架级描述 + 关键设计意图，详细数据结构 / 算法 / UI 留待 v1.5+ 单独展开。
>
> **本文件存在的目的**：
> 1. 标记一个已识别但暂不实现的关键缺口，避免被遗忘
> 2. 提前框定设计原则，避免未来与愿景偏离
> 3. 给 Layer 1 / Layer 3 的当下决定一个参考边界（什么事归 Layer 2，什么事不归）

---

## 0. 定位

### 0.1 Layer 2 是什么

> **Layer 2 = 把"原始信息"转成"原子化知识"放进 Layer 1 的桥梁。**

```
原始信息（任何人能产生的东西）：
  ├─ 用户的笔记（NoteView 里的文字）
  ├─ 用户的对话（与 AI Web 的交流）
  ├─ 公共知识图谱（Wikidata / Schema.org / ConceptNet）
  ├─ 用户的手动拖拽（图谱编辑器）
  └─ 网页 / 电子书 / 文献（Web / EBookView）

           ↓ Layer 2 的"桥"

Layer 1 atom 体系：
  graph_geometry / graph_intension_atom / graph_presentation_atom
```

### 0.2 Layer 2 不是什么

- ❌ **不是自建 NLP / 实体抽取引擎** — 调 LLM API，不训模型
- ❌ **不是离线全量导入工具** — 不预下载 Wikidata 全量
- ❌ **不是知识推理引擎** — 推理交给图谱计算工具 / 大模型，KRIG 不自建
- ❌ **不是无人工审核的自动化** — 任何写入 atom 都必须经过人确认（愿景 §5.6 + §8）

### 0.3 一句话定位

> **Layer 2 = AI 编排 + 公共 API 调用 + 人机闭环审核**，让 atom 增量生长，伴随用户阅读和写作。

不是新工程的工程，是**已有能力的编排**：
- AI 抽取能力 → 已接入 AI Web
- 用户笔记 → 已有 NoteView / EBookView / WebView
- 图谱容器 → Layer 1 已实现 v1.4

Layer 2 = 把这些"接起来"。

---

## 1. 核心理念

### 1.1 三大原则

| 原则 | 说明 |
|------|------|
| **API / LLM 优先** | 不自建 NLP；用 GPT / Claude / Gemini API 抽取实体和关系 |
| **按需增量** | 用户每选一段、问一次，长一点；不全量导入 |
| **人是仲裁者** | AI 提议三元组 → 用户审核 → 才入图（愿景 §5.6 强约束） |

### 1.2 与愿景的对应

| 愿景原则 | Layer 2 表现 |
|---------|------------|
| §5.1 图谱面向机器 / 视图面向人 | Layer 2 的输出是 atom（机器层），不直接动视图 |
| §5.2 关系是资产 / 视图是消耗品 | AI 抽的三元组 = 候选资产，必须经人确认才"算数" |
| §5.4 用户能创造视图模式 | 不仅创造视图，连**关系类型**用户都能创造（AI 提议新关系类型 → 用户接受） |
| §5.6 视图是双向接口 | 笔记 / AI 对话本身就是"视图"；从中抽 atom 是"反向接口"的极致体现 |
| §8 AI 不替代人判断 | Layer 2 的核心约束 |

---

## 2. 三种内容来源

### 2.1 来源 A：AI 抽取用户笔记（核心场景）

```
用户读红楼梦时，在 NoteView 写：
  "贾宝玉是贾母的孙子，林黛玉是贾敏的女儿。
   贾敏是贾母的女儿。"

→ 用户在编辑器里选这段 → 右键"提取知识到图谱"
→ KRIG 调 LLM API（带 prompt 模板：实体 + 关系抽取）
→ LLM 返回候选三元组：
     [贾宝玉, 祖孙关系, 贾母]
     [林黛玉, 母女关系, 贾敏]
     [贾敏, 母女关系, 贾母]
→ KRIG 弹出审核面板：用户对每条 ✓/✗/✏️
→ 通过的转成 atom 写入 Layer 1
→ 图谱视图自动更新
```

**优先级最高**，是 KRIG-Note 区别于 Wikipedia 浏览器的关键特征。

### 2.2 来源 B：公共知识图谱按需查询

```
用户在图谱里点一个节点 "贾宝玉" → 右键"补充公共知识"
→ KRIG 调 Wikidata SPARQL API：
     SELECT ?p ?v WHERE { wd:Q3247428 ?p ?v }  // 贾宝玉
→ 返回候选属性：作者(曹雪芹) / 类型(虚构人物) / 出处(红楼梦)
→ 用户选哪些导入
→ 转成 atom 写入
```

**优先级中**，对齐机制（用户的"贾宝玉" = Wikidata Q3247428）需要慎重设计。

### 2.3 来源 C：用户手动（已部分实现）

```
图谱编辑器：拖拽节点 / 加边 / 改属性
v1.4 已实现部分（Markdown 导入 + 拖动持久化）
v2.x 加更多直接编辑能力
```

**优先级最低**（已部分实现），但**永远是兜底入口**。

### 2.4 优先级

```
v1.5：来源 C 完善（可视化编辑增强）
v2.0：来源 A 实现（AI 抽取 NoteView 选段）
v2.x：来源 B 实现（Wikidata 按需查询 + 实体对齐）
v3.0：自动监测 / 后台抽取 / 主动建议（高级能力）
```

---

## 3. 工作流场景：红楼梦端到端例子

⚠️ **占位，待 v2.0 milestone 启动时展开**。框架版本如下：

```
T0  用户在 NoteView 写笔记记录《红楼梦》第三回
T1  选中一段对话场景的描述
T2  右键 "提取知识"
T3  KRIG 调 LLM，prompt 含：
        - 选中文本
        - 当前图谱已有实体（避免重复）
        - 期望输出格式（JSON 三元组）
T4  LLM 返回：
        candidate triples + confidence
T5  KRIG 弹审核面板：
        每条三元组带 ✓ / ✗ / ✏️ + 置信度
T6  用户审核：通过/拒绝/修改
T7  通过的转成 atom 写入 graph_intension_atom
        + 元数据：sourced_from='ai-extract', source_text=..., confidence=0.85, verified_by=user, verified_at=...
T8  图谱视图自动更新（涌现新节点 / 新边）
T9  下次用户再读 → 重复 T1-T8 → 图谱增量长大
```

**关键 UI 设计原则**：
- 审核面板**不打断阅读流**（侧边栏，不是模态）
- 每条三元组要能**追溯到原文**（点击跳回原段落）
- **拒绝 ≠ 删除** — 拒绝写入"反例"标记，避免下次 AI 重复提议

---

## 4. 数据接口（Layer 2 → Layer 1）

⚠️ **占位**。原则提前定下：

### 4.1 atom 加元数据字段

每条 AI 抽取的 atom 要带"溯源 + 置信"信息：

```typescript
interface GraphIntensionAtomRecord {
  // 已有字段（v1.4）
  id, graph_id, subject_id, predicate, value, value_kind, ...

  // ⚠️ Layer 2 新增（v2.0）
  sourced_from?: 'manual' | 'ai-extract' | 'wikidata' | 'schema-org' | 'concept-net' | 'import-md';
  source_ref?: string;       // 原文位置 / Wikidata QID / ...
  confidence?: number;       // 0..1，AI 给的置信度
  human_verified?: boolean;  // 用户是否确认过
  verified_at?: number;
}
```

### 4.2 实体对齐表（可选）

⚠️ **占位**。v2.x 加 `graph_entity_alias` 表，记录"用户的贾宝玉 = Wikidata Q3247428"。

### 4.3 反例 / 拒绝表（可选）

⚠️ **占位**。v2.x 加 `graph_rejected_triple`，避免 AI 重复提议被拒绝过的三元组。

---

## 5. 优先级与里程碑

| Milestone | 范围 | 状态 |
|-----------|------|------|
| **B3** | Pattern + View Mode（Layer 3，独立于 Layer 2） | 进行中 |
| **L2.1** (~v2.0) | 来源 A：AI 抽取 NoteView 选段 + 审核面板 | 占位 |
| **L2.2** (~v2.x) | 来源 B：Wikidata 按需查询 + 实体对齐 | 占位 |
| **L2.3** (~v3.0) | 自动监测 / 主动建议 | 远期 |

**与 B3 的关系**：B3（Layer 3）和 L2.1（Layer 2）**不互相阻塞**。B3 完成后 KRIG 可以"美化空图谱"；L2.1 完成后 KRIG 可以"长出图谱"。两者**叠加才是完整的 KRIG-Note**。

---

## 6. 不在范围

明确**不做**的事，避免愿景泛化：

- ❌ **自建 NER / RE 模型** — 永远调 API
- ❌ **离线全量公共图谱** — 永远按需查询
- ❌ **无人工审核的自动写入** — 严格违反愿景 §5.6 + §8
- ❌ **复杂的本体推理引擎** — 推理交给 LLM 或外部图谱工具
- ❌ **多语言 NER 自研** — 完全交给 LLM
- ❌ **替代 Wikidata / Schema.org** — KRIG 是消费方，不是生产方

---

## 7. 修订历史

| 日期 | 修订 | 触发 |
|------|------|------|
| 2026-04-28 | v0.1 框架占位 | wenwu 在 B3.1 spec 起草中指出 Layer 1 实际只是容器、内容靠 Layer 2 填充；明确"不自建 NLP，调 API + 按需增量" |
