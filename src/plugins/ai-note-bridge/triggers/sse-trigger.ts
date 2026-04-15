/**
 * SSE Trigger — live chat sync.
 *
 * Polls window.__krig_sse_responses on the guest webview every second.
 * Each record has `id` (request-id) and `streaming` (true while the
 * stream is open, flipped to false on `message_stop`). A record that
 * is now non-streaming and we haven't yet processed signals "a turn
 * just finished" — we then pull the latest assistant turn from the
 * conversation API and emit it.
 *
 * Polling instead of an in-page push because the SSE inject script
 * mutates `window.__krig_sse_responses` directly (no event), and
 * sub-second cadence is fine for a chat that takes seconds to stream.
 *
 * Live mode never invokes CDP / mouse synthesis. Artifact placeholders
 * are replaced by a "click Claude's copy button" callout via
 * processClaudeArtifactsLive — the user copies images manually if they
 * want them.
 */

import { extractClaudeConversation, isClaudeConversationPage } from '../../web-bridge/capabilities/claude-api-extractor';
import { processClaudeArtifactsLive } from '../pipeline/claude-artifacts';
import { getSSECaptureScript } from '../../web-bridge/injection/inject-scripts/sse-capture';
import { detectAIServiceByUrl } from '../../../shared/types/ai-service-types';

declare const viewAPI: {
  sendToOtherSlot: (m: { protocol: string; action: string; payload: unknown }) => void;
  onMessage: (cb: (m: { protocol: string; action: string; payload: any }) => void) => () => void;
};

export interface SseTriggerHandle {
  /** Stop polling and detach listeners. */
  dispose: () => void;
  /** Temporarily suppress auto-emits, e.g. while a manual extraction is running. */
  suspendFor: (ms: number) => void;
}

interface SseRecordSnapshot {
  id?: string;
  streaming?: boolean;
  service?: string;
  timestamp?: number;
}

export function startSseTrigger(
  webviewRef: { current: Electron.WebviewTag | null },
): SseTriggerHandle {
  // Per-conversation set of message uuids we've already emitted.
  const synced = new Map<string, Set<string>>();
  // Per-webview set of SSE record ids whose "stream finished" we've
  // already reacted to. Decoupled from `synced` so a Claude response
  // that yields no new human-uuid (rare) doesn't get re-processed
  // every poll.
  const reactedRecordIds = new Set<string>();
  // Strict serial lock — never run two extractions in parallel.
  let inflight: Promise<void> = Promise.resolve();
  // Whether NoteView is mounted (broadcast via as:note-status). When
  // false we still mark records reacted but skip the actual emit.
  let noteOpen = false;
  let stopped = false;
  let suspendedUntil = 0;

  function getSyncedSet(convId: string): Set<string> {
    let s = synced.get(convId);
    if (!s) { s = new Set(); synced.set(convId, s); }
    return s;
  }

  // ── Listen for NoteView open/close ──
  const unsubStatus = viewAPI.onMessage((msg) => {
    if (msg.protocol === 'ai-sync' && msg.action === 'as:note-status') {
      noteOpen = !!msg.payload?.open;
    }
  });

  // Probe once so we get an immediate status update if NoteView
  // mounted before the trigger started.
  viewAPI.sendToOtherSlot({ protocol: 'ai-sync', action: 'as:probe', payload: null });

  // ── Inject SSE capture on every navigation, not just legacy paths ──
  const installSse = () => {
    const el = webviewRef.current;
    if (!el) return;
    try {
      const url = el.getURL?.() || '';
      const profile = detectAIServiceByUrl(url);
      if (!profile) return;
      const script = getSSECaptureScript(profile.id, profile.intercept.endpointPattern);
      el.executeJavaScript(script).catch(() => {});
    } catch {}
  };

  // Wait for webview to attach, then install SSE on dom-ready /
  // navigations.
  let detachListeners: (() => void) | null = null;
  const ensureListeners = () => {
    if (detachListeners) return;
    const el = webviewRef.current;
    if (!el) return;
    const handler = () => installSse();
    el.addEventListener('dom-ready', handler);
    el.addEventListener('did-navigate', handler);
    el.addEventListener('did-navigate-in-page', handler);
    detachListeners = () => {
      el.removeEventListener('dom-ready', handler);
      el.removeEventListener('did-navigate', handler);
      el.removeEventListener('did-navigate-in-page', handler);
    };
    // First install (in case dom-ready fired before we attached).
    installSse();
  };

  // ── Poll loop ──
  async function tick(): Promise<void> {
    if (stopped) return;
    if (Date.now() < suspendedUntil) return;
    const el = webviewRef.current;
    if (!el) return;
    ensureListeners();

    // Only handle Claude in this iteration. ChatGPT / Gemini live sync
    // can be added when their SSE scripts emit the same signal.
    const url = el.getURL?.() || '';
    const profile = detectAIServiceByUrl(url);
    if (!profile || profile.id !== 'claude') return;
    if (!isClaudeConversationPage(url)) return;

    let records: SseRecordSnapshot[] = [];
    try {
      records = (await el.executeJavaScript(
        '(window.__krig_sse_responses || []).map(function(r){ return { id: r.id, streaming: r.streaming, service: r.service, timestamp: r.timestamp }; })',
      )) || [];
    } catch {
      return;
    }

    // Find newly-finished records we haven't reacted to.
    const newlyFinished = records.filter(r =>
      r && r.id && r.streaming === false && !reactedRecordIds.has(r.id),
    );
    if (newlyFinished.length === 0) return;
    for (const r of newlyFinished) reactedRecordIds.add(r.id!);

    if (!noteOpen) {
      // Note isn't open — drop silently. User can re-open NoteView and
      // hit "保存到 Note" later for a full re-sync.
      return;
    }

    // Process serially via the inflight chain so multiple finished
    // records (rare but possible) don't race each other.
    inflight = inflight.then(() => emitLatest(el)).catch((err) => {
      console.warn('[AI/Bridge/Live] emit failed:', err);
    });
  }

  async function emitLatest(webview: Electron.WebviewTag): Promise<void> {
    const conv = await extractClaudeConversation(webview);
    if (!conv) return;
    const convId = conv.uuid || 'unknown';
    const set = getSyncedSet(convId);

    // Walk human messages in order, emit any pair whose human uuid
    // we haven't synced yet.
    let turnIdx = set.size;
    for (let i = 0; i < conv.messages.length; i++) {
      const m = conv.messages[i];
      if (m.sender !== 'human') continue;
      if (set.has(m.uuid)) continue;

      // Find the next assistant after this human.
      let assistantText = '';
      for (let j = i + 1; j < conv.messages.length; j++) {
        if (conv.messages[j].sender === 'assistant') {
          assistantText = conv.messages[j].text;
          break;
        }
      }
      if (!assistantText) {
        // Streaming may still be flushing — bail; next finished record
        // will retrigger us.
        break;
      }

      const finalMd = processClaudeArtifactsLive(assistantText, webview.getURL());
      viewAPI.sendToOtherSlot({
        protocol: 'ai-sync',
        action: 'as:append-turn',
        payload: {
          turn: {
            index: turnIdx,
            userMessage: m.text,
            markdown: finalMd,
            timestamp: Date.now(),
          },
          source: {
            serviceId: 'claude',
            serviceName: 'Claude',
          },
        },
      });
      set.add(m.uuid);
      turnIdx += 1;
    }
  }

  const interval = setInterval(() => { void tick(); }, 1000);

  return {
    dispose: () => {
      stopped = true;
      clearInterval(interval);
      unsubStatus();
      detachListeners?.();
    },
    suspendFor: (ms: number) => {
      suspendedUntil = Math.max(suspendedUntil, Date.now() + Math.max(0, ms));
    },
  };
}
