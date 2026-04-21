import { createRoot } from 'react-dom/client';
import { useState, useEffect, useCallback } from 'react';
import type { ViewMessage } from '../../shared/types';

/**
 * Demo View — 验证 View 生命周期、WorkMode 切换、双栏布局、消息双工
 */

declare const viewAPI: {
  sendToOtherSlot: (message: ViewMessage) => void;
  onMessage: (callback: (message: ViewMessage) => void) => () => void;
  openCompanion: (workModeId: string) => Promise<void>;
  closeCompanion: () => Promise<void>;
  onStateChanged: (callback: (state: unknown) => void) => () => void;
};

const DEMO_CONFIG: Record<string, { emoji: string; title: string; color: string; desc: string }> = {
  'demo-a': { emoji: '📝', title: 'Note View', color: '#4a9eff', desc: 'NoteView plugin slot' },
  'demo-b': { emoji: '📕', title: 'PDF View', color: '#ff5252', desc: 'PDFView plugin slot' },
  'demo-c': { emoji: '🌐', title: 'Web View', color: '#4caf50', desc: 'WebView plugin slot' },
};

function DemoView() {
  const [workModeId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('workModeId') || 'demo-a';
  });
  const [messages, setMessages] = useState<string[]>([]);
  const [pingCount, setPingCount] = useState(0);

  const config = DEMO_CONFIG[workModeId] || DEMO_CONFIG['demo-a'];

  // 监听来自对面 Slot 的消息
  useEffect(() => {
    const unsubscribe = viewAPI.onMessage((msg: ViewMessage) => {
      const text = `← [${msg.protocol}:${msg.action}] ${JSON.stringify(msg.payload)}`;
      setMessages((prev) => [...prev.slice(-4), text]); // 保留最近 5 条
    });
    return unsubscribe;
  }, []);

  // 发送 ping 消息到对面 Slot
  const handleSendPing = useCallback(() => {
    const count = pingCount + 1;
    setPingCount(count);
    const msg: ViewMessage = {
      protocol: 'demo',
      action: 'ping',
      payload: { from: workModeId, count, timestamp: Date.now() },
    };
    viewAPI.sendToOtherSlot(msg);
    setMessages((prev) => [...prev.slice(-4), `→ [demo:ping] #${count} from ${workModeId}`]);
  }, [workModeId, pingCount]);

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={{ ...styles.toolbarDot, background: config.color }} />
        <span style={styles.toolbarTitle}>{config.title}</span>
        <div style={styles.toolbarSpacer} />
        <button style={styles.toolbarButton} onClick={handleSendPing} title="Send ping to other slot">
          📡 Ping
        </button>
      </div>

      {/* Content */}
      <div style={styles.content}>
        <div style={styles.message}>
          <div style={styles.emoji}>{config.emoji}</div>
          <h2 style={{ ...styles.heading, color: config.color }}>{config.title}</h2>
          <p style={styles.text}>{config.desc}</p>
          <p style={styles.subtext}>WorkMode: {workModeId}</p>

          {/* 消息日志 */}
          {messages.length > 0 && (
            <div style={styles.messageLog}>
              <div style={styles.messageLogTitle}>Message Log</div>
              {messages.map((m, i) => (
                <div key={i} style={{
                  ...styles.messageLogItem,
                  color: m.startsWith('→') ? '#4caf50' : '#4a9eff',
                }}>
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1e1e1e',
    color: '#e8eaed',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '36px',
    padding: '0 16px',
    borderBottom: '1px solid #333',
    background: '#252525',
  },
  toolbarDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  toolbarTitle: {
    fontSize: '13px',
    fontWeight: 500,
  },
  toolbarSpacer: {
    flex: 1,
  },
  toolbarButton: {
    border: '1px solid #555',
    borderRadius: '4px',
    background: 'transparent',
    color: '#e8eaed',
    fontSize: '11px',
    padding: '2px 8px',
    cursor: 'pointer',
  },
  content: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    textAlign: 'center',
    maxWidth: '400px',
  },
  emoji: {
    fontSize: '48px',
    marginBottom: '12px',
  },
  heading: {
    fontSize: '24px',
    marginBottom: '8px',
    fontWeight: 600,
  },
  text: {
    fontSize: '14px',
    color: '#aaa',
    marginBottom: '4px',
  },
  subtext: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '16px',
  },
  messageLog: {
    textAlign: 'left',
    background: '#111',
    borderRadius: '8px',
    padding: '12px',
    marginTop: '16px',
  },
  messageLogTitle: {
    fontSize: '11px',
    color: '#888',
    marginBottom: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  messageLogItem: {
    fontSize: '11px',
    fontFamily: 'monospace',
    padding: '2px 0',
  },
};

const root = createRoot(document.getElementById('root')!);
root.render(<DemoView />);
