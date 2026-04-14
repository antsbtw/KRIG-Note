/**
 * Guest WebContents Registry
 *
 * 维护 host webContents → guest webContents 的映射。
 * 当 webview 标签 attach 到 host 时，在 onViewCreated 中注册。
 * 让 main 进程的各种 WebBridge 功能（CDP、注入等）能够通过
 * host id 找到对应的 guest 页面 webContents。
 */

const hostToGuest = new Map<number, Electron.WebContents>();

export function registerGuest(hostWebContents: Electron.WebContents, guest: Electron.WebContents): void {
  hostToGuest.set(hostWebContents.id, guest);
  guest.on('destroyed', () => {
    hostToGuest.delete(hostWebContents.id);
  });
  hostWebContents.on('destroyed', () => {
    hostToGuest.delete(hostWebContents.id);
  });
}

export function getGuest(hostWebContentsId: number): Electron.WebContents | null {
  const guest = hostToGuest.get(hostWebContentsId);
  if (!guest || guest.isDestroyed()) return null;
  return guest;
}
