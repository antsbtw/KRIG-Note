import { useEffect, useState } from 'react';
import type { PerfStats } from '../engines/GraphEngine';
import { getSvgCacheStats } from '../../../lib/atom-serializers/svg';
import { SvgGeometryContent } from '../rendering/contents/SvgGeometryContent';
import { getFontLoadStats } from '../../../lib/atom-serializers/svg/font-loader';
import { getMathjaxInitMs } from '../../../lib/atom-serializers/svg/mathjax-svg';
import type { PerfConfig } from '../perf/PerfConfig';
import type { AdaptiveState } from '../perf/AdaptivePolicy';
import { loadHistory, clearHistory } from '../perf/PerfHistory';

interface PerfPanelProps {
  /** 取当前 engine 的 perfStats */
  getStats: () => PerfStats | null;
  /** v1.3 § 10.3：取自适应状态（hover 暂停 / LOD 启用） */
  getAdaptiveState?: () => AdaptiveState | null;
  /** v1.3 § 10.3：取/设置 PerfConfig */
  getPerfConfig?: () => PerfConfig | null;
  setPerfConfig?: (config: PerfConfig) => void;
}

/**
 * v1.3 § 10.2 + § 10.3：渲染层性能监控 + 自适应配置面板。
 *
 * 默认收起为右下角 ⏱ 小按钮，点击展开显示 4 段：
 *   render: nodes / last node / setup / fps
 *   cache:  svg / geom 命中率
 *   init:   字体加载 / MathJax 初始化耗时
 *   adapt:  当前自适应状态 + 配置控件 + 历史摘要
 *
 * 500ms 轮询刷新。fps 红/黄/绿 颜色根据阈值。
 */
export function PerfPanel({ getStats, getAdaptiveState, getPerfConfig, setPerfConfig }: PerfPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'stats' | 'adapt'>('stats');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const stats = getStats();
  void tick; // 仅触发重渲

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="性能监控"
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          width: 28,
          height: 28,
          padding: 0,
          background: 'rgba(40,44,52,0.85)',
          color: '#888',
          border: '1px solid #444',
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 11,
          cursor: 'pointer',
          zIndex: 100,
        }}
      >
        ⏱
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        bottom: 12,
        width: 320,
        padding: 10,
        background: 'rgba(20,22,28,0.95)',
        color: '#ddd',
        border: '1px solid #555',
        borderRadius: 6,
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.6,
        zIndex: 100,
        userSelect: 'none',
        maxHeight: '70vh',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>Perf · v1.3</strong>
        <button
          onClick={() => setOpen(false)}
          style={{ background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: 14, padding: 0, width: 18 }}
          title="关闭"
        >×</button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <TabBtn active={tab === 'stats'} onClick={() => setTab('stats')}>stats</TabBtn>
        <TabBtn active={tab === 'adapt'} onClick={() => setTab('adapt')}>adapt</TabBtn>
      </div>

      {tab === 'stats' ? (
        <StatsTab stats={stats} />
      ) : (
        <AdaptTab
          adaptive={getAdaptiveState?.() ?? null}
          config={getPerfConfig?.() ?? null}
          onConfigChange={setPerfConfig}
        />
      )}
    </div>
  );
}

// ── Stats Tab ──

function StatsTab({ stats }: { stats: PerfStats | null }) {
  const svgCache = getSvgCacheStats();
  const geomCache = SvgGeometryContent.getGeometryCacheStats();
  const fontStats = getFontLoadStats();
  const mathjaxMs = getMathjaxInitMs();

  return (
    <>
      <Section title="render">
        <Row label="nodes" value={stats?.totalNodes ?? 0} />
        <Row label="last node" value={fmtMs(stats?.lastNodeMs)} />
        <Row label="setup" value={fmtMs(stats?.totalSetupMs)} />
        <Row label="fps" value={fmtFps(stats?.fps)} color={fpsColor(stats?.fps)} />
      </Section>

      <Section title="cache">
        <Row label="svg" value={`${svgCache.size}/${1000} · ${(svgCache.hitRate * 100).toFixed(0)}%`} />
        <Row label="geom" value={`${geomCache.size}/${500} · ${(geomCache.hitRate * 100).toFixed(0)}%`} />
      </Section>

      <Section title="init">
        {Object.entries(fontStats).map(([key, s]) =>
          s ? <Row key={key} label={key} value={`${s.ms.toFixed(0)}ms ${s.sizeKb.toFixed(0)}KB`} /> : null,
        )}
        <Row label="mathjax" value={mathjaxMs > 0 ? fmtMs(mathjaxMs) : '-'} />
      </Section>
    </>
  );
}

// ── Adapt Tab ──

interface AdaptTabProps {
  adaptive: AdaptiveState | null;
  config: PerfConfig | null;
  onConfigChange?: (config: PerfConfig) => void;
}

function AdaptTab({ adaptive, config, onConfigChange }: AdaptTabProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  if (!config) {
    return <div style={{ color: '#888' }}>config unavailable</div>;
  }

  const updateMode = (mode: PerfConfig['mode']) => {
    onConfigChange?.({ ...config, mode });
  };
  const updateThreshold = (key: keyof PerfConfig['thresholds'], value: number) => {
    onConfigChange?.({ ...config, thresholds: { ...config.thresholds, [key]: value } });
  };
  const updateAction = (key: keyof PerfConfig['actions'], value: boolean) => {
    onConfigChange?.({ ...config, actions: { ...config.actions, [key]: value } });
  };

  return (
    <>
      <Section title="state">
        <Row
          label="hover"
          value={adaptive?.hoverPaused ? 'paused' : 'active'}
          color={adaptive?.hoverPaused ? '#fc7' : '#7c7'}
        />
        <Row
          label="LOD"
          value={adaptive?.lodEnabled ? 'on' : 'off'}
          color={adaptive?.lodEnabled ? '#fc7' : '#888'}
        />
      </Section>

      <Section title="mode">
        <div style={{ display: 'flex', gap: 4 }}>
          {(['auto', 'manual', 'off'] as const).map((m) => (
            <button
              key={m}
              onClick={() => updateMode(m)}
              style={modeBtnStyle(config.mode === m)}
            >{m}</button>
          ))}
        </div>
      </Section>

      <Section title="thresholds">
        <NumInput
          label="fpsLow"
          value={config.thresholds.fpsLow}
          min={10} max={60}
          onChange={(v) => updateThreshold('fpsLow', v)}
        />
        <NumInput
          label="fpsRecover"
          value={config.thresholds.fpsRecover}
          min={20} max={70}
          onChange={(v) => updateThreshold('fpsRecover', v)}
        />
        <NumInput
          label="lodNodeCount"
          value={config.thresholds.lodNodeCount}
          min={50} max={10000} step={50}
          onChange={(v) => updateThreshold('lodNodeCount', v)}
        />
      </Section>

      <Section title="actions">
        <Toggle
          label="pauseHoverOnLowFps"
          checked={config.actions.pauseHoverOnLowFps}
          onChange={(v) => updateAction('pauseHoverOnLowFps', v)}
        />
        <Toggle
          label="lodOnHighNodeCount"
          checked={config.actions.lodOnHighNodeCount}
          onChange={(v) => updateAction('lodOnHighNodeCount', v)}
        />
      </Section>

      <Section title="history">
        <button
          onClick={() => setHistoryOpen((o) => !o)}
          style={{ background: '#333', color: '#ccc', border: '1px solid #555', padding: '2px 6px', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10 }}
        >{historyOpen ? '收起' : '展开'}</button>
        {historyOpen && <HistoryTable />}
      </Section>
    </>
  );
}

function HistoryTable() {
  const history = loadHistory();
  if (history.length === 0) {
    return <div style={{ color: '#888', fontSize: 10, marginTop: 4 }}>(no history)</div>;
  }
  const recent = history.slice(-10).reverse();
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', color: '#666', fontSize: 9, borderBottom: '1px solid #333', paddingBottom: 2, marginBottom: 2 }}>
        <span style={{ width: 60 }}>time</span>
        <span style={{ width: 50 }}>nodes</span>
        <span style={{ width: 70 }}>fps avg/min</span>
        <span style={{ flex: 1 }}>deg</span>
      </div>
      {recent.map((s, i) => (
        <div key={i} style={{ display: 'flex', fontSize: 10 }}>
          <span style={{ width: 60, color: '#888' }}>{fmtTime(s.startedAt)}</span>
          <span style={{ width: 50 }}>{s.maxNodes}</span>
          <span style={{ width: 70 }}>{s.fps.avg.toFixed(0)}/{s.fps.min.toFixed(0)}</span>
          <span style={{ flex: 1, color: s.degradationCount > 0 ? '#fc7' : '#666' }}>{s.degradationCount}</span>
        </div>
      ))}
      <button
        onClick={() => { clearHistory(); window.location.reload(); }}
        style={{ marginTop: 4, background: '#333', color: '#999', border: '1px solid #555', padding: '1px 6px', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit', fontSize: 9 }}
      >clear history (reload)</button>
    </div>
  );
}

// ── 通用组件 ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: color ?? '#ddd' }}>{value}</span>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? '#3a4a5a' : '#2a2d33',
        color: active ? '#fff' : '#888',
        border: '1px solid ' + (active ? '#5a7090' : '#444'),
        padding: '3px 8px',
        borderRadius: 3,
        fontFamily: 'inherit',
        fontSize: 11,
        cursor: 'pointer',
      }}
    >{children}</button>
  );
}

function NumInput({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v)) onChange(v);
        }}
        style={{ width: 70, background: '#2a2d33', color: '#ddd', border: '1px solid #444', borderRadius: 3, padding: '1px 4px', fontFamily: 'inherit', fontSize: 11, textAlign: 'right' }}
      />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function modeBtnStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    background: active ? '#3a4a5a' : '#2a2d33',
    color: active ? '#fff' : '#888',
    border: '1px solid ' + (active ? '#5a7090' : '#444'),
    padding: '3px 6px',
    borderRadius: 3,
    fontFamily: 'inherit',
    fontSize: 10,
    cursor: 'pointer',
  };
}

function fmtMs(v: number | undefined): string {
  if (v === undefined || v === null) return '-';
  return `${v.toFixed(1)}ms`;
}

function fmtFps(v: number | undefined): string {
  if (!v || v === 0) return '-';
  return v.toFixed(0);
}

function fpsColor(v: number | undefined): string | undefined {
  if (!v) return undefined;
  if (v >= 55) return '#7c7';
  if (v >= 30) return '#fc7';
  return '#f77';
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
