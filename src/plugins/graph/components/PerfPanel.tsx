import { useEffect, useState } from 'react';
import type { PerfStats } from '../engines/GraphEngine';
import {
  getSvgCacheStats,
  type Atom as _Atom,  // eslint-disable-line @typescript-eslint/no-unused-vars
} from '../../../lib/atom-serializers/svg';
import { SvgGeometryContent } from '../rendering/contents/SvgGeometryContent';
import { getFontLoadStats } from '../../../lib/atom-serializers/svg/font-loader';
import { getMathjaxInitMs } from '../../../lib/atom-serializers/svg/mathjax-svg';

interface PerfPanelProps {
  /** 取当前 engine 的 perfStats */
  getStats: () => PerfStats | null;
}

/**
 * v1.3 § 10.2：渲染层性能监控面板。
 *
 * 默认收起为右上角小按钮，点击展开显示完整 perf 数据：
 * - 节点数 / 单节点耗时 / setup 耗时 / fps
 * - SvgCache / GeometryCache 命中率
 * - 字体加载耗时 / MathJax 初始化耗时
 *
 * 500ms 轮询刷新。fps 红/黄/绿 颜色根据阈值（v1.3 § 10.1 性能预算）。
 */
export function PerfPanel({ getStats }: PerfPanelProps) {
  const [open, setOpen] = useState(false);
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

  const svgCache = getSvgCacheStats();
  const geomCache = SvgGeometryContent.getGeometryCacheStats();
  const fontStats = getFontLoadStats();
  const mathjaxMs = getMathjaxInitMs();

  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        bottom: 12,
        width: 280,
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
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>Perf · v1.3</strong>
        <button
          onClick={() => setOpen(false)}
          style={{
            background: 'transparent',
            color: '#888',
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            padding: 0,
            width: 18,
          }}
          title="关闭"
        >
          ×
        </button>
      </div>

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
    </div>
  );
}

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
  // 阈值参考 v1.3 § 10.1：60+ 绿 / 30-60 黄 / <30 红
  if (v >= 55) return '#7c7';
  if (v >= 30) return '#fc7';
  return '#f77';
}
