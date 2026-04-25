export function GraphView() {
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
    </div>
  );
}
