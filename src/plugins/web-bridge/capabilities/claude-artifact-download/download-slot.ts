/**
 * download-slot.ts
 *
 * Serializes main-process will-download captures for the Claude artifact
 * download module. Electron's `will-download` event carries no request id,
 * so concurrent captures cannot be told apart — one listener would grab
 * another caller's download. This module enforces a single in-flight slot.
 *
 * Call `captureOneDownload(view, timeout)` from renderer: it waits for any
 * prior capture to release, then arms the main-side one-shot listener via
 * `WB_CAPTURE_DOWNLOAD_ONCE`, and returns the raw bytes on success.
 *
 * Lifecycle:
 *   arm → trigger action (button click / CDP menu) → will-download fires →
 *   main reads temp file → bytes returned → slot released (success/timeout/error).
 */

export interface DownloadCapture {
  /** Raw bytes of the downloaded file (byte-exact, no encoding applied). */
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

/**
 * Minimal shape of the renderer-exposed viewAPI we depend on. Declared
 * locally to avoid coupling to a global viewAPI typedef that may lag.
 */
export interface ViewAPIDownloadCapture {
  wbCaptureDownloadOnce: (timeoutMs?: number) => Promise<{
    success: boolean;
    filename?: string;
    mimeType?: string;
    contentBase64?: string;
    byteLength?: number;
    error?: string;
  }>;
}

export class DownloadSlotBusyError extends Error {
  constructor() {
    super('download slot busy — a prior capture is still in flight');
    this.name = 'DownloadSlotBusyError';
  }
}

export class DownloadSlotTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`download capture timed out after ${ms}ms`);
    this.name = 'DownloadSlotTimeoutError';
  }
}

export class DownloadSlotFailedError extends Error {
  constructor(public readonly reason: string) {
    super(`download capture failed: ${reason}`);
    this.name = 'DownloadSlotFailedError';
  }
}

let slotInFlight: Promise<unknown> | null = null;

/**
 * Arm a one-shot download capture on the current webview's session. Returns
 * the raw bytes once Electron's will-download fires and completes.
 *
 * Only one capture can be in flight at a time. Callers MUST arm before
 * triggering the action that causes the download (button click / CDP
 * menu), because the arm-to-event window is all that distinguishes "our"
 * download from any incidental one.
 *
 * @param view renderer-side viewAPI (must include wbCaptureDownloadOnce)
 * @param timeoutMs how long to wait for will-download before giving up (default 10s)
 * @throws DownloadSlotBusyError if another capture is already in flight
 * @throws DownloadSlotTimeoutError on timeout
 * @throws DownloadSlotFailedError on any other main-side failure
 */
export async function captureOneDownload(
  view: ViewAPIDownloadCapture,
  timeoutMs = 10_000,
): Promise<DownloadCapture> {
  if (slotInFlight) throw new DownloadSlotBusyError();
  console.log('[DownloadSlot] capture start', { timeoutMs });

  const promise = (async (): Promise<DownloadCapture> => {
    const r = await view.wbCaptureDownloadOnce(timeoutMs);
    if (!r.success) {
      console.warn('[DownloadSlot] capture failed', { timeoutMs, error: r.error ?? 'unknown' });
      if (r.error && r.error.startsWith('timeout')) {
        throw new DownloadSlotTimeoutError(timeoutMs);
      }
      throw new DownloadSlotFailedError(r.error ?? 'unknown');
    }
    if (!r.contentBase64) {
      console.warn('[DownloadSlot] capture empty content', { filename: r.filename, mimeType: r.mimeType });
      throw new DownloadSlotFailedError('empty content');
    }
    const bytes = base64ToBytes(r.contentBase64);
    console.log('[DownloadSlot] capture success', {
      filename: r.filename ?? 'artifact',
      mimeType: r.mimeType ?? 'application/octet-stream',
      byteLength: bytes.length,
    });
    return {
      bytes,
      filename: r.filename ?? 'artifact',
      mimeType: r.mimeType ?? 'application/octet-stream',
    };
  })();

  slotInFlight = promise;
  try {
    return await promise;
  } finally {
    slotInFlight = null;
  }
}

/** True iff a download capture is currently in flight. For diagnostics / tests. */
export function isDownloadSlotBusy(): boolean {
  return slotInFlight !== null;
}

function base64ToBytes(b64: string): Uint8Array {
  // atob is available in both renderer (browser context) and modern Node.
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
