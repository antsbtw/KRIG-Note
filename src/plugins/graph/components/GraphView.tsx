import { useEffect, useState } from 'react';

declare const viewAPI: {
  onRestoreWorkspaceState: (cb: (state: { activeGraphId?: string | null }) => void) => () => void;
  onGraphActiveChanged: (cb: (graphId: string | null) => void) => () => void;
};

export function GraphView() {
  const [activeGraphId, setActiveGraphId] = useState<string | null>(null);

  useEffect(() => {
    const unsub1 = viewAPI.onRestoreWorkspaceState((state) => {
      if (state.activeGraphId !== undefined) setActiveGraphId(state.activeGraphId);
    });
    const unsub2 = viewAPI.onGraphActiveChanged((graphId) => {
      setActiveGraphId(graphId);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#888',
        gap: 8,
        userSelect: 'none',
      }}
    >
      <div style={{ fontSize: 32 }}>🕸</div>
      <div style={{ fontSize: 14 }}>GraphView</div>
      <div style={{ fontSize: 12, opacity: 0.6 }}>v1.1 骨架 · 引擎待接入</div>
      <div style={{ fontSize: 11, opacity: 0.5, marginTop: 16 }}>
        当前活跃图：{activeGraphId ? <code style={{ color: '#aaa' }}>{activeGraphId}</code> : <span style={{ opacity: 0.6 }}>（未选）</span>}
      </div>
    </div>
  );
}
