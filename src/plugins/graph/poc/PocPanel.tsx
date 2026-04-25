import { useEffect, useRef, useState } from 'react';
import { PocScene } from './PocScene';
import type { PocNode } from './types';

const SAMPLE_NODES: PocNode[] = [
  // 单行西文
  {
    id: 'n1',
    position: { x: -360, y: 100 },
    atoms: [{ type: 'textBlock', content: [{ type: 'text', text: 'Hello PoC' }] }],
  },
  // 文字 + 简单 inline 公式
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
  // 中文 + 中英混排
  {
    id: 'n3',
    position: { x: 120, y: 100 },
    atoms: [{ type: 'textBlock', content: [{ type: 'text', text: '中文 mixed 测试 ABC' }] }],
  },
  // 复杂 inline 公式（开方 + 分数）
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
  // 多行 textBlock + display math（重头戏）
  {
    id: 'n5',
    position: { x: -120, y: -80 },
    atoms: [
      { type: 'textBlock', content: [{ type: 'text', text: '巴塞尔级数：' }] },
      { type: 'mathBlock', attrs: { tex: '\\sum_{i=1}^{n} \\frac{1}{i^2}' } },
      { type: 'textBlock', content: [{ type: 'text', text: '当 n→∞ 时收敛于 π²/6' }] },
    ],
  },
  // 矩阵
  {
    id: 'n6',
    position: { x: 220, y: -80 },
    atoms: [
      { type: 'textBlock', content: [{ type: 'text', text: '矩阵示例：' }] },
      {
        type: 'mathBlock',
        attrs: { tex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
      },
    ],
  },
];

export function PocPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PocScene | null>(null);
  const [stats, setStats] = useState<string>('initializing...');
  const [error, setError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new PocScene(containerRef.current);
    sceneRef.current = scene;
    scene.onHoverChange = (id) => setHoverId(id);

    scene
      .loadNodes(SAMPLE_NODES)
      .then(() => {
        const { lastNodeMs, totalNodes, totalSetupMs } = scene.perfStats;
        setStats(
          `loaded ${totalNodes} nodes in ${totalSetupMs.toFixed(1)}ms (last: ${lastNodeMs.toFixed(1)}ms)`,
        );
      })
      .catch((e: Error) => {
        console.error('[PoC] load nodes failed', e);
        setError(e.message ?? String(e));
      });

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

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
        }}
      >
        <button
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('poc');
            window.location.href = url.toString();
          }}
          style={{
            background: '#333',
            color: '#ccc',
            border: '1px solid #555',
            padding: '2px 8px',
            borderRadius: 3,
            fontFamily: 'inherit',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          ← 返回 GraphView
        </button>
        <span>Graph 3D PoC · {stats}</span>
        {hoverId && <span style={{ color: '#ffaa3b' }}>hover: {hoverId}</span>}
        {error && <span style={{ color: '#f55', marginLeft: 'auto' }}>error: {error}</span>}
      </div>
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }} />
    </div>
  );
}
