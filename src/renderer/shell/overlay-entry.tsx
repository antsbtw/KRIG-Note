import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalProgressOverlay } from './GlobalProgressOverlay';

declare const shellAPI: {
  onProgressStart: (cb: (p: unknown) => void) => () => void;
  onProgressDone: (cb: (p: unknown) => void) => () => void;
};

/** 当有任务显示时，恢复 body 的鼠标事件（否则默认 pointer-events: none，点击穿透） */
function OverlayRoot() {
  useEffect(() => {
    const unsubStart = shellAPI.onProgressStart(() => {
      document.body.classList.add('has-overlay');
    });
    const unsubDone = shellAPI.onProgressDone(() => {
      // 完成后延迟移除（让用户看到成功提示）
      setTimeout(() => document.body.classList.remove('has-overlay'), 0);
    });
    return () => { unsubStart(); unsubDone(); };
  }, []);
  return <GlobalProgressOverlay />;
}

const root = createRoot(document.getElementById('root')!);
root.render(<OverlayRoot />);
