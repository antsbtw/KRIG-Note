/**
 * 节点 Tab — 编辑选中节点的 substance 和视觉覆盖（B4.2.b）。
 *
 * 设计对齐 Figma Properties Panel：
 *   Substance  当前引用的 substance（点击替换）
 *   Layout     尺寸（W × H）
 *   Fill       填充色 + 不透明度
 *   Stroke     描边色 + 宽度 + 样式
 *   Shape      形状选择
 *   Label      label 位置 + 颜色 + 字号
 *
 * 编辑路径：
 *   - 修改：onSetVisualOverride(geometryId, attribute, value) → 写 layout_id='*' 的 atom
 *   - 重置：onClearVisualOverride(geometryId, attribute) → 删除该 atom，恢复 substance 默认值
 *
 * 区分"用户 override"vs"substance 默认值"：
 *   - 当属性来自 override → 字段右侧显示 ↺ 重置按钮
 *   - 当属性是默认值 → 字段右侧无重置按钮
 *
 * 多选（selectedIds.size > 1）：第 4 步实装；本步显示提示
 */
import { useState } from 'react';
import type {
  GraphGeometryRecord,
  GraphIntensionAtomRecord,
  GraphPresentationAtomRecord,
} from '../../../../main/storage/types';
import { substanceLibrary } from '../../substance';
import type { Substance, SubstanceOrigin, SubstanceVisual } from '../../substance/types';
import { isInLayoutFamily } from '../../layout/layout-family';
import { NumberInput, ColorInput, SegRow, SegButton } from './InspectorWidgets';

export interface NodeInspectorTabProps {
  graphId: string;
  layoutId: string;
  selectedIds: ReadonlySet<string>;
  geometries: GraphGeometryRecord[];
  intensions: GraphIntensionAtomRecord[];
  presentations: GraphPresentationAtomRecord[];
  onReplaceSubstance: (geometryIds: string[], newSubstanceId: string) => Promise<void>;
  onSetVisualOverride: (geometryIds: string[], attribute: string, value: string) => Promise<void>;
  onClearVisualOverride: (geometryIds: string[], attribute: string) => Promise<void>;
  onForgeSubstance: (geometryIds: string[]) => Promise<void>;
}

export function NodeInspectorTab({
  layoutId,
  selectedIds,
  geometries,
  intensions,
  presentations,
  onReplaceSubstance,
  onSetVisualOverride,
  onClearVisualOverride,
  onForgeSubstance,
}: NodeInspectorTabProps) {
  if (selectedIds.size === 0) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>👆</div>
        <div>点击节点以编辑</div>
        <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>
          支持 Shift/Cmd/Ctrl 多选 · 拖空白框选
        </div>
      </div>
    );
  }

  // 单选 / 多选共用一套字段：算每个属性的共有值（多选时不一致 → 'mixed'）
  const ids = [...selectedIds];
  const isMulti = ids.length > 1;

  // 检测选中几何体的 kind 分布
  const kinds = new Set(
    ids.map((id) => geometries.find((g) => g.id === id)?.kind ?? 'point'),
  );
  const onlyEdges = kinds.size === 1 && kinds.has('line');
  const mixedKinds = kinds.size > 1;

  if (mixedKinds) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: 13, color: '#bbb', marginBottom: 6 }}>
          已选 {ids.length} 个元素（混合类型）
        </div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          请仅选择节点或仅选择边
        </div>
      </div>
    );
  }

  const info = computeMultiNodeInfo(ids, intensions, presentations, layoutId);

  const set = (attr: string, val: string) => onSetVisualOverride(ids, attr, val);
  const clr = (attr: string) => onClearVisualOverride(ids, attr);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {isMulti ? <MultiSelectionHeader count={ids.length} /> : <NodeIdRow id={ids[0]!} />}

      <button onClick={() => onForgeSubstance(ids)} style={forgeButtonStyle} title="把当前选中凝结为可复用的 substance">
        ⬢ 凝结为 Substance
      </button>

      <Section title="Substance">
        <SubstancePicker
          currentId={info.substanceId}
          currentLabel={info.substanceLabel}
          mixed={info.substanceMixed}
          onPick={(newId) => onReplaceSubstance(ids, newId)}
        />
      </Section>

      {!onlyEdges && (<>
      <Section title="Layout">
        <FieldRow label="W" override={info.size.width.override} onReset={() => clr('size.width')}>
          <NumberInput
            value={fieldValueAsString(info.size.width)}
            onCommit={(v) => set('size.width', v)}
            placeholder={info.size.width.mixed ? 'Mixed' : '默认'}
            integer
          />
        </FieldRow>
        <FieldRow label="H" override={info.size.height.override} onReset={() => clr('size.height')}>
          <NumberInput
            value={fieldValueAsString(info.size.height)}
            onCommit={(v) => set('size.height', v)}
            placeholder={info.size.height.mixed ? 'Mixed' : '默认'}
            integer
          />
        </FieldRow>
      </Section>

      <Section title="Fill">
        <FieldRow label="Color" override={info.fill.color.override} onReset={() => clr('fill.color')}>
          <ColorInput
            value={info.fill.color.value}
            mixed={info.fill.color.mixed}
            onCommit={(v) => set('fill.color', v)}
          />
        </FieldRow>
        <FieldRow label="Opacity" override={info.fill.opacity.override} onReset={() => clr('fill.opacity')}>
          <NumberInput
            value={fieldValueAsString(info.fill.opacity)}
            onCommit={(v) => {
              const n = parseFloat(v);
              if (Number.isNaN(n)) return;
              set('fill.opacity', String(n > 1 ? n / 100 : n));
            }}
            placeholder={info.fill.opacity.mixed ? 'Mixed' : '0~1'}
          />
        </FieldRow>
      </Section>

      <Section title="Stroke">
        <FieldRow label="Color" override={info.border.color.override} onReset={() => clr('border.color')}>
          <ColorInput
            value={info.border.color.value}
            mixed={info.border.color.mixed}
            onCommit={(v) => set('border.color', v)}
          />
        </FieldRow>
        <FieldRow label="Width" override={info.border.width.override} onReset={() => clr('border.width')}>
          <NumberInput
            value={fieldValueAsString(info.border.width)}
            onCommit={(v) => set('border.width', v)}
            placeholder={info.border.width.mixed ? 'Mixed' : '默认'}
          />
        </FieldRow>
        <FieldRow label="Style" override={info.border.style.override} onReset={() => clr('border.style')}>
          <SegRow>
            {(['solid', 'dashed', 'dotted'] as const).map((s) => (
              <SegButton
                key={s}
                active={info.border.style.value === s}
                onClick={() => set('border.style', s)}
              >
                {STYLE_LABELS[s]}
              </SegButton>
            ))}
          </SegRow>
        </FieldRow>
      </Section>

      <Section title="Shape">
        <FieldRow label="" override={info.shape.override} onReset={() => clr('shape')}>
          <SegRow>
            {(['circle', 'rounded-rect', 'hexagon'] as const).map((s) => (
              <SegButton
                key={s}
                active={info.shape.value === s}
                onClick={() => set('shape', s)}
                title={s}
              >
                {SHAPE_LABELS[s]}
              </SegButton>
            ))}
          </SegRow>
        </FieldRow>
      </Section>

      </>)}

      {onlyEdges && (
        <Section title="边">
          <FieldRow label="Color" override={info.border.color.override} onReset={() => clr('border.color')}>
            <ColorInput value={info.border.color.value} mixed={info.border.color.mixed} onCommit={(v) => set('border.color', v)} />
          </FieldRow>
          <FieldRow label="Width" override={info.border.width.override} onReset={() => clr('border.width')}>
            <NumberInput
              value={fieldValueAsString(info.border.width)}
              onCommit={(v) => set('border.width', v)}
              placeholder={info.border.width.mixed ? 'Mixed' : '默认'}
            />
          </FieldRow>
          <FieldRow label="Style" override={info.border.style.override} onReset={() => clr('border.style')}>
            <SegRow>
              {(['solid', 'dashed', 'dotted'] as const).map((s) => (
                <SegButton key={s} active={info.border.style.value === s} onClick={() => set('border.style', s)}>
                  {STYLE_LABELS[s]}
                </SegButton>
              ))}
            </SegRow>
          </FieldRow>
        </Section>
      )}

      {!onlyEdges && (<>
      <Section title="Label">
        <FieldRow label="位置" override={info.label.layout.override} onReset={() => clr('labelLayout')}>
          <SegRow>
            {(['below-center', 'inside-center', 'right-of'] as const).map((s) => (
              <SegButton
                key={s}
                active={info.label.layout.value === s}
                onClick={() => set('labelLayout', s)}
                title={s}
              >
                {LABEL_POS_LABELS[s]}
              </SegButton>
            ))}
          </SegRow>
        </FieldRow>
        <FieldRow label="Color" override={info.label.color.override} onReset={() => clr('text.color')}>
          <ColorInput
            value={info.label.color.value}
            mixed={info.label.color.mixed}
            onCommit={(v) => set('text.color', v)}
          />
        </FieldRow>
        <FieldRow label="Size" override={info.label.size.override} onReset={() => clr('text.size')}>
          <NumberInput
            value={fieldValueAsString(info.label.size)}
            onCommit={(v) => set('text.size', v)}
            placeholder={info.label.size.mixed ? 'Mixed' : '默认'}
            integer
          />
        </FieldRow>
      </Section>
      </>)}

      <Hint>↺ 表示已自定义，点击恢复默认值{isMulti ? ' · 修改将应用到所有选中元素' : ''}</Hint>
    </div>
  );
}

const STYLE_LABELS = { solid: '实线', dashed: '虚线', dotted: '点线' } as const;
const SHAPE_LABELS = { circle: '圆', 'rounded-rect': '方', hexagon: '六边' } as const;
const LABEL_POS_LABELS = { 'below-center': '下方', 'inside-center': '内部', 'right-of': '右侧' } as const;

// ── 辅助：从 atom 数据汇总单节点信息 ──

/** 字段值 + 元信息（多选一致性 / 是否 override） */
interface FieldValue<T> {
  /** 共有值；mixed=true 时 value 无意义 */
  value: T | undefined;
  /** 多选时该字段值不一致 */
  mixed: boolean;
  /** 至少一个节点对该 attribute 有 override（决定是否显示 ↺ 重置按钮） */
  override: boolean;
}

interface NodeInfo {
  substanceId: string | undefined;
  substanceLabel: string | undefined;
  /** 多选时不同节点 substance 不同 */
  substanceMixed: boolean;
  shape: FieldValue<string>;
  size: { width: FieldValue<number | string>; height: FieldValue<number | string> };
  fill: { color: FieldValue<string>; opacity: FieldValue<number | string> };
  border: { color: FieldValue<string>; width: FieldValue<number | string>; style: FieldValue<string> };
  label: { layout: FieldValue<string>; color: FieldValue<string>; size: FieldValue<number | string> };
}

/**
 * 计算 N 个选中节点的字段共有值。
 * 每个属性：所有节点的有效值（override > substance.visual default）一致 → 该值；不一致 → mixed
 */
function computeMultiNodeInfo(
  geometryIds: string[],
  intensions: GraphIntensionAtomRecord[],
  presentations: GraphPresentationAtomRecord[],
  layoutId: string,
): NodeInfo {
  if (geometryIds.length === 0) {
    return emptyNodeInfo();
  }

  // 每个节点：substance + override map
  type PerNode = {
    substanceId: string | undefined;
    visual: SubstanceVisual;
    overrides: Map<string, string>;
  };
  const perNode: PerNode[] = geometryIds.map((gid) => {
    const subAtom = intensions.find((a) => a.subject_id === gid && a.predicate === 'substance');
    const sid = subAtom ? String(subAtom.value) : undefined;
    const sub = sid ? substanceLibrary.get(sid) : undefined;
    const ovr = new Map<string, string>();
    for (const p of presentations) {
      if (p.subject_id !== gid) continue;
      if (!isInLayoutFamily(p.layout_id, layoutId)) continue;
      ovr.set(p.attribute, p.value);
    }
    return { substanceId: sid, visual: sub?.visual ?? {}, overrides: ovr };
  });

  // 算 substance 一致性
  const substanceIds = new Set(perNode.map((n) => n.substanceId));
  const substanceMixed = substanceIds.size > 1;
  const firstSubstance = perNode[0]!;
  const substanceId = substanceMixed ? undefined : firstSubstance.substanceId;
  const substance = substanceId ? substanceLibrary.get(substanceId) : undefined;
  const substanceLabel = substanceMixed ? undefined : (substance?.label ?? substanceId);

  // 每属性：算所有节点的有效值（override > visual default）→ 检查一致性
  const field = <T extends string | number>(
    attr: string,
    pickDefault: (v: SubstanceVisual) => T | undefined,
  ): FieldValue<T> => {
    const values: (T | undefined)[] = perNode.map((n) => {
      const o = n.overrides.get(attr);
      if (o !== undefined) {
        // override 是 string，按 T 推断转换
        return (typeof pickDefault(n.visual) === 'number' ? Number(o) : o) as T;
      }
      return pickDefault(n.visual);
    });
    const override = perNode.some((n) => n.overrides.has(attr));
    const first = values[0];
    const mixed = values.some((v) => v !== first);
    return { value: mixed ? undefined : first, mixed, override };
  };

  return {
    substanceId,
    substanceLabel,
    substanceMixed,
    shape: field<string>('shape', (v) => v.shape ?? 'circle'),
    size: {
      width: field<number | string>('size.width', (v) => v.size?.width),
      height: field<number | string>('size.height', (v) => v.size?.height),
    },
    fill: {
      color: field<string>('fill.color', (v) => v.fill?.color),
      opacity: field<number | string>('fill.opacity', (v) => v.fill?.opacity),
    },
    border: {
      color: field<string>('border.color', (v) => v.border?.color),
      width: field<number | string>('border.width', (v) => v.border?.width),
      style: field<string>('border.style', (v) => v.border?.style ?? 'solid'),
    },
    label: {
      layout: field<string>('labelLayout', (v) => v.labelLayout ?? 'below-center'),
      color: field<string>('text.color', (v) => v.text?.color),
      size: field<number | string>('text.size', (v) => v.text?.size),
    },
  };
}

function emptyNodeInfo(): NodeInfo {
  const empty = { value: undefined, mixed: false, override: false };
  return {
    substanceId: undefined,
    substanceLabel: undefined,
    substanceMixed: false,
    shape: empty,
    size: { width: empty, height: empty },
    fill: { color: empty, opacity: empty },
    border: { color: empty, width: empty, style: empty },
    label: { layout: empty, color: empty, size: empty },
  };
}

function fieldValueAsString(f: FieldValue<number | string>): string {
  if (f.mixed) return '';
  if (f.value === undefined) return '';
  return String(f.value);
}

// ── 子组件 ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={sectionTitleStyle}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function FieldRow({
  label,
  children,
  override,
  onReset,
}: {
  label: string;
  children: React.ReactNode;
  override: boolean;
  onReset: () => void;
}) {
  return (
    <div style={fieldRowStyle}>
      {label && <span style={fieldLabelStyle}>{label}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {override && (
        <button
          onClick={onReset}
          title="重置为 substance 默认值"
          style={resetButtonStyle}
        >
          ↺
        </button>
      )}
    </div>
  );
}

function NodeIdRow({ id }: { id: string }) {
  return (
    <div style={nodeIdStyle}>
      <span style={{ fontSize: 10, color: '#666' }}>NODE</span>
      <span style={{ fontSize: 11, color: '#bbb', fontFamily: 'monospace', marginLeft: 6 }}>
        {id.length > 18 ? id.slice(0, 8) + '…' + id.slice(-6) : id}
      </span>
    </div>
  );
}

function MultiSelectionHeader({ count }: { count: number }) {
  return (
    <div style={{ ...nodeIdStyle, justifyContent: 'space-between' }}>
      <span style={{ fontSize: 10, color: '#666' }}>SELECTION</span>
      <span style={{ fontSize: 11, color: '#60a5fa' }}>已选 {count} 个节点</span>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={hintStyle}>{children}</div>;
}

// ── SubstancePicker ──

function SubstancePicker({
  currentId,
  currentLabel,
  mixed,
  onPick,
}: {
  currentId: string | undefined;
  currentLabel: string | undefined;
  mixed?: boolean;
  onPick: (newId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const all = substanceLibrary.list();
  const filtered = filterAndGroup(all, query);

  const display = mixed ? (
    <span style={{ color: '#666' }}>Mixed</span>
  ) : currentLabel ? (
    currentLabel
  ) : (
    <span style={{ color: '#666' }}>(未指定)</span>
  );

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setQuery('');
        }}
        style={pickerTriggerStyle}
      >
        <span style={{ flex: 1, textAlign: 'left' }}>{display}</span>
        <span style={{ color: '#666', marginLeft: 6 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div style={popoverStyle}>
          <input
            autoFocus
            type="text"
            placeholder="搜索 substance..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={searchInputStyle}
          />
          <div style={popoverListStyle}>
            {filtered.length === 0 && (
              <div style={{ padding: 12, fontSize: 11, color: '#666', textAlign: 'center' }}>
                无匹配
              </div>
            )}
            {filtered.map(({ origin, items }) => (
              <div key={origin}>
                <div style={originLabelStyle}>{ORIGIN_LABELS[origin]}</div>
                {items.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onPick(s.id);
                      setOpen(false);
                    }}
                    style={{
                      ...pickerItemStyle,
                      ...(s.id === currentId ? pickerItemActiveStyle : {}),
                    }}
                  >
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      <span style={{ fontSize: 12 }}>{s.label}</span>
                      <span style={pickerItemIdStyle}>{s.id}</span>
                    </span>
                    {s.id === currentId && <span style={{ color: '#60a5fa' }}>✓</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ORIGIN_LABELS: Record<SubstanceOrigin, string> = {
  base: '系统基类',
  'built-in': '内置领域',
  theme: '主题包',
  community: '社区扩展',
  user: '我的 substance',
};

const ORIGIN_ORDER: SubstanceOrigin[] = ['user', 'community', 'theme', 'built-in', 'base'];

function filterAndGroup(
  all: Substance[],
  query: string,
): Array<{ origin: SubstanceOrigin; items: Substance[] }> {
  const q = query.trim().toLowerCase();
  const matched = q
    ? all.filter(
        (s) => s.id.toLowerCase().includes(q) || s.label.toLowerCase().includes(q),
      )
    : all;
  const byOrigin = new Map<SubstanceOrigin, Substance[]>();
  for (const s of matched) {
    const o: SubstanceOrigin = s.origin ?? 'built-in';
    const arr = byOrigin.get(o) ?? [];
    arr.push(s);
    byOrigin.set(o, arr);
  }
  const out: Array<{ origin: SubstanceOrigin; items: Substance[] }> = [];
  for (const o of ORIGIN_ORDER) {
    const items = byOrigin.get(o);
    if (items && items.length > 0) {
      items.sort((a, b) => a.label.localeCompare(b.label));
      out.push({ origin: o, items });
    }
  }
  return out;
}

// ── 样式 ──

const emptyStyle: React.CSSProperties = {
  color: '#888',
  fontSize: 12,
  textAlign: 'center',
  padding: '24px 0',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const fieldLabelStyle: React.CSSProperties = {
  color: '#888',
  fontSize: 11,
  width: 50,
  flexShrink: 0,
};

const resetButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#60a5fa',
  fontSize: 14,
  cursor: 'pointer',
  padding: '0 4px',
  flexShrink: 0,
  outline: 'none',
};

const nodeIdStyle: React.CSSProperties = {
  padding: '4px 6px',
  background: '#0f0f10',
  borderRadius: 3,
  display: 'flex',
  alignItems: 'center',
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#666',
  fontStyle: 'italic',
  marginTop: 4,
  textAlign: 'center',
};

const forgeButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  background: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)',
  color: '#fff',
  border: '1px solid #60a5fa',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  outline: 'none',
};

// ── SubstancePicker 样式 ──

const pickerTriggerStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  background: '#0f0f10',
  color: '#e8eaed',
  border: '1px solid #333',
  borderRadius: 3,
  fontSize: 12,
  padding: '5px 8px',
  cursor: 'pointer',
  outline: 'none',
};

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  background: '#1a1a1c',
  border: '1px solid #444',
  borderRadius: 4,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 320,
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
};

const searchInputStyle: React.CSSProperties = {
  background: '#0f0f10',
  color: '#e8eaed',
  border: 'none',
  borderBottom: '1px solid #333',
  borderRadius: '4px 4px 0 0',
  fontSize: 12,
  padding: '6px 8px',
  outline: 'none',
};

const popoverListStyle: React.CSSProperties = {
  overflowY: 'auto',
  flex: 1,
  padding: '4px 0',
};

const originLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#666',
  padding: '4px 8px 2px',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const pickerItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  background: 'transparent',
  border: 'none',
  color: '#bbb',
  padding: '5px 10px',
  fontSize: 12,
  cursor: 'pointer',
  outline: 'none',
  textAlign: 'left',
};

const pickerItemActiveStyle: React.CSSProperties = {
  background: 'rgba(96, 165, 250, 0.15)',
  color: '#e8eaed',
};

const pickerItemIdStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  color: '#666',
  fontFamily: 'monospace',
  marginTop: 1,
};
