import { useEffect, useRef, useState } from 'react';
import { PocScene } from './PocScene';
import type { PocNode } from './types';

const SAMPLE_NODES: PocNode[] = [
  {
    id: 'n1',
    position: { x: -200, y: 80 },
    atoms: [
      {
        type: 'textBlock',
        content: [{ type: 'text', text: 'Hello PoC' }],
      },
    ],
  },
  {
    id: 'n2',
    position: { x: 0, y: 80 },
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
    position: { x: 200, y: 80 },
    atoms: [
      {
        type: 'textBlock',
        content: [{ type: 'text', text: '中文测试' }],
      },
    ],
  },
];

export function PocPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PocScene | null>(null);
  const [stats, setStats] = useState<string>('initializing...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new PocScene(containerRef.current);
    sceneRef.current = scene;

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
        {error && <span style={{ color: '#f55', marginLeft: 'auto' }}>error: {error}</span>}
      </div>
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }} />
    </div>
  );
}
