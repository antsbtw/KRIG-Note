import { useEffect, useRef, useState } from 'react';
import { PocScene } from './PocScene';
import { generateNodes } from './sample-generator';
import type { PocNode } from './types';

const SHOWCASE_NODES: PocNode[] = [
  {
    id: 'n1',
    position: { x: -360, y: 100 },
    atoms: [{ type: 'textBlock', content: [{ type: 'text', text: 'Hello PoC' }] }],
  },
  {
    id: 'n2',
    position: { x: -120, y: 100 },
    atoms: [
      {
        type: 'textBlock',
        content: [
          { type: 'text', text: 'Energy = ' },
          { type: 'mathInline', attrs: { tex: 'E = mc^2' } },
        ],
      },
    ],
  },
  {
    id: 'n3',
    position: { x: 120, y: 100 },
    atoms: [{ type: 'textBlock', content: [{ type: 'text', text: '中文 mixed 测试 ABC' }] }],
  },
  {
    id: 'n4',
    position: { x: 360, y: 100 },
    atoms: [
      {
        type: 'textBlock',
        content: [
          { type: 'text', text: 'f(x) = ' },
          { type: 'mathInline', attrs: { tex: '\\sqrt{x^2 + \\frac{1}{x}}' } },
        ],
      },
    ],
  },
  {
    id: 'n5',
    position: { x: -120, y: -80 },
    atoms: [
      { type: 'textBlock', content: [{ type: 'text', text: '巴塞尔级数：' }] },
      { type: 'mathBlock', attrs: { tex: '\\sum_{i=1}^{n} \\frac{1}{i^2}' } },
      { type: 'textBlock', content: [{ type: 'text', text: '当 n→∞ 时收敛于 π²/6' }] },
    ],
  },
  {
    id: 'n6',
    position: { x: 220, y: -80 },
    atoms: [
      { type: 'textBlock', content: [{ type: 'text', text: '矩阵示例：' }] },
      { type: 'mathBlock', attrs: { tex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' } },
    ],
  },
];

const PRESETS: Array<{ label: string; build: () => PocNode[] }> = [
  { label: '6 (showcase)', build: () => SHOWCASE_NODES },
  { label: '50', build: () => generateNodes(50) },
  { label: '100', build: () => generateNodes(100) },
  { label: '200', build: () => generateNodes(200) },
];

export function PocPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PocScene | null>(null);
  const [stats, setStats] = useState<string>('initializing...');
  const [error, setError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [presetIdx, setPresetIdx] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new PocScene(containerRef.current);
    sceneRef.current = scene;
    scene.onHoverChange = (id) => setHoverId(id);

    const nodes = PRESETS[presetIdx].build();
    setStats(`loading ${nodes.length} nodes...`);
    setError(null);

    scene
      .loadNodes(nodes)
      .then(() => {
        const { lastNodeMs, totalNodes, totalSetupMs } = scene.perfStats;
        setStats(
          `${totalNodes} nodes · setup ${totalSetupMs.toFixed(0)}ms · avg ${(totalSetupMs / totalNodes).toFixed(1)}ms · last ${lastNodeMs.toFixed(1)}ms`,
        );
      })
      .catch((e: Error) => {
        console.error('[PoC] load nodes failed', e);
        setError(e.message ?? String(e));
      });

    const fpsTimer = window.setInterval(() => {
      setFps(scene.perfStats.fps);
    }, 500);

    return () => {
      window.clearInterval(fpsTimer);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [presetIdx]);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '8px 12px',
          background: '#222',
          color: '#aaa',
          fontFamily: 'monospace',
          fontSize: 12,
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('poc');
            window.location.href = url.toString();
          }}
          style={btnStyle()}
        >
          ← 返回 GraphView
        </button>
        <span style={{ color: '#888' }}>preset:</span>
        {PRESETS.map((p, i) => (
          <button
            key={p.label}
            onClick={() => setPresetIdx(i)}
            style={btnStyle(i === presetIdx)}
          >
            {p.label}
          </button>
        ))}
        <span style={{ marginLeft: 8 }}>{stats}</span>
        <span style={{ color: fps >= 55 ? '#7c7' : fps >= 30 ? '#fc7' : '#f77' }}>
          {fps.toFixed(0)} fps
        </span>
        {hoverId && <span style={{ color: '#ffaa3b' }}>hover: {hoverId}</span>}
        {error && <span style={{ color: '#f55', marginLeft: 'auto' }}>error: {error}</span>}
      </div>
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }} />
    </div>
  );
}

function btnStyle(active = false): React.CSSProperties {
  return {
    background: active ? '#3a4a5a' : '#333',
    color: active ? '#fff' : '#ccc',
    border: '1px solid ' + (active ? '#5a7090' : '#555'),
    padding: '2px 8px',
    borderRadius: 3,
    fontFamily: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
  };
}
