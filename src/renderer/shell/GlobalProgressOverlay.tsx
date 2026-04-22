import { useEffect, useState } from 'react';
import type { ProgressStartPayload, ProgressUpdatePayload, ProgressDonePayload } from '../../shared/types';

declare const shellAPI: {
  onProgressStart: (callback: (payload: ProgressStartPayload) => void) => () => void;
  onProgressUpdate: (callback: (payload: ProgressUpdatePayload) => void) => () => void;
  onProgressDone: (callback: (payload: ProgressDonePayload) => void) => () => void;
};

interface ProgressState {
  taskId: string;
  title: string;
  message?: string;
  indeterminate: boolean;
  current: number;
  total: number;
  done: boolean;
  success?: boolean;
  doneMessage?: string;
}

export function GlobalProgressOverlay() {
  const [state, setState] = useState<ProgressState | null>(null);

  useEffect(() => {
    const unsubStart = shellAPI.onProgressStart((p) => {
      setState({
        taskId: p.taskId,
        title: p.title,
        message: p.message,
        indeterminate: p.indeterminate ?? true,
        current: 0,
        total: 0,
        done: false,
      });
    });

    const unsubUpdate = shellAPI.onProgressUpdate((p) => {
      setState((prev) => {
        if (!prev || prev.taskId !== p.taskId) return prev;
        return {
          ...prev,
          message: p.message ?? prev.message,
          current: p.current ?? prev.current,
          total: p.total ?? prev.total,
          indeterminate: p.total == null ? prev.indeterminate : false,
        };
      });
    });

    const unsubDone = shellAPI.onProgressDone((p) => {
      setState((prev) => {
        if (!prev || prev.taskId !== p.taskId) return prev;
        return { ...prev, done: true, success: p.success, doneMessage: p.message };
      });
    });

    return () => { unsubStart(); unsubUpdate(); unsubDone(); };
  }, []);

  if (!state) return null;

  const percent = state.indeterminate || state.total === 0
    ? null
    : Math.min(100, Math.round((state.current / state.total) * 100));

  return (
    <div style={styles.overlay} onClick={(e) => e.stopPropagation()}>
      <div style={styles.panel}>
        <div style={styles.title}>{state.title}</div>
        {state.message && <div style={styles.message}>{state.message}</div>}

        <div style={styles.barContainer}>
          {state.indeterminate ? (
            <div style={styles.indeterminateBar}>
              <div style={styles.indeterminateFill} />
            </div>
          ) : (
            <div style={styles.bar}>
              <div style={{ ...styles.barFill, width: `${percent}%` }} />
            </div>
          )}
        </div>

        {!state.indeterminate && percent != null && (
          <div style={styles.percent}>{percent}%  ({state.current}/{state.total})</div>
        )}

        {state.done && (
          <div style={styles.doneRow}>
            <div style={state.success ? styles.successText : styles.errorText}>
              {state.doneMessage ?? (state.success ? '完成' : '失败')}
            </div>
            <button style={styles.closeBtn} onClick={() => setState(null)}>关闭</button>
          </div>
        )}
        {!state.done && <div style={styles.hint}>请勿关闭窗口或操作应用</div>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100000,
    backdropFilter: 'blur(2px)',
  },
  panel: {
    width: 420,
    padding: '24px 28px',
    background: '#2a2a2a',
    border: '1px solid #3a3a3a',
    borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
    color: '#eaeaea',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    fontSize: 13,
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 8,
  },
  message: {
    color: '#b0b0b0',
    marginBottom: 16,
    minHeight: 18,
  },
  barContainer: {
    marginBottom: 8,
  },
  bar: {
    height: 6,
    background: '#1a1a1a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #4a9eff, #6dc7ff)',
    transition: 'width 200ms ease-out',
  },
  indeterminateBar: {
    height: 6,
    background: '#1a1a1a',
    borderRadius: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  indeterminateFill: {
    position: 'absolute',
    height: '100%',
    width: '40%',
    background: 'linear-gradient(90deg, #4a9eff, #6dc7ff)',
    animation: 'progress-indet 1.2s ease-in-out infinite',
  },
  percent: {
    fontSize: 12,
    color: '#8a8a8a',
    textAlign: 'right',
  },
  hint: {
    marginTop: 16,
    fontSize: 11,
    color: '#7a7a7a',
    textAlign: 'center',
  },
  doneRow: {
    marginTop: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  successText: { color: '#7dd87d' },
  errorText: { color: '#ff7d7d' },
  closeBtn: {
    padding: '6px 16px',
    background: '#3a3a3a',
    color: '#eaeaea',
    border: '1px solid #4a4a4a',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
};

// 注入 keyframe（组件挂载时添加，不存在才加）
if (typeof document !== 'undefined' && !document.getElementById('progress-indet-kf')) {
  const style = document.createElement('style');
  style.id = 'progress-indet-kf';
  style.textContent = `
    @keyframes progress-indet {
      0% { left: -40%; }
      100% { left: 100%; }
    }
  `;
  document.head.appendChild(style);
}
