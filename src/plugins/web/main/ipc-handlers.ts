import { ipcMain, BaseWindow, BrowserWindow, dialog, shell, net, session } from 'electron';
import { IPC } from '../../../shared/types';
import { workspaceManager } from '../../../main/workspace/manager';
import {
  getSlotBySenderId,
  getActiveViewWebContentsIds,
  getActiveProtocol,
  hasRightSlot,
} from '../../../main/window/shell';
import type { PluginContext } from '../../../shared/plugin-types';
import { noteStore } from '../../../main/storage/note-store';
import { thoughtStore } from '../../../main/storage/thought-store';
import { activityStore } from '../../../main/storage/activity-store';
import { isDBReady } from '../../../main/storage/client';
import { lookupWord } from '../../../main/learning/dictionary-service';
import { googleTranslate, googleTTS } from '../../../main/learning/providers/google-translate';
import { vocabStore } from '../../../main/learning/vocabulary-store';
import { checkStatus as ytdlpCheckStatus, install as ytdlpInstall } from '../../../main/ytdlp/binary-manager';
import { downloadVideo, getVideoInfo, saveTranslationSubtitle } from '../../../main/ytdlp/downloader';
import { getEBookData } from '../../../main/ebook/file-loader';
import { ebookStore as bookshelfStore } from '../../../main/ebook/bookshelf-surreal-store';
import { bookmarkSurrealStore as webBookmarkStore } from './bookmark-surreal-store';
import { historySurrealStore as webHistoryStore } from './history-surreal-store';
import { WEBVIEW_PARTITION } from '../../../shared/constants/webview-partition';
import {
  browserArtifactService,
  browserCapabilityTraceWriter,
  getPageIdForWebContents,
} from '../../browser-capability';
import { setPendingNoteId } from '../../note/main/ipc-handlers';

/**
 * Web Plugin — IPC Handlers
 *
 * 处理所有 Web 相关的 IPC 通道：
 * - WEB_TRANSLATE, LEARNING（翻译/查词/TTS/生词本）
 * - AI_*（AI 对话、解析、提取缓存）
 * - WB_*（WebBridge：捕获、CDP、鼠标/键盘事件）
 * - BROWSER_CAPABILITY_*（Claude/ChatGPT 对话提取）
 * - TWEET/YOUTUBE/YTDLP（媒体获取）
 * - WEB_BOOKMARK/WEB_FOLDER/WEB_HISTORY（书签/历史）
 * - EXTRACTION（PDF 平台提取）
 */

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function registerWebIpcHandlers(ctx: PluginContext): void {
  const getMainWindow = ctx.getMainWindow;
  // ── 广播辅助 ──
  function broadcastVocabChanged(): void {
    const win = getMainWindow();
    if (!win) return;
    vocabStore.list().then((entries) => {
      for (const view of win.contentView.children) {
        if ('webContents' in view) {
          (view as any).webContents.send(IPC.LEARNING_VOCAB_CHANGED, entries);
        }
      }
    }).catch(() => {});
  }

  function broadcastNoteList(): void {
    const win = getMainWindow();
    if (!win) return;
    noteStore.list().then((list: any) => {
      for (const view of win.contentView.children) {
        if ('webContents' in view) {
          (view as any).webContents.send(IPC.NOTE_LIST_CHANGED, list);
        }
      }
    }).catch(() => {});
  }

  function broadcastContentTree(): void {
    broadcastNoteList();
  }

  function broadcastToAll(channel: string, ...args: unknown[]): void {
    const win = getMainWindow();
    if (!win) return;
    for (const child of win.contentView.children) {
      if ('webContents' in child) {
        (child as any).webContents.send(channel, ...args);
      }
    }
  }

  // ── Web Translate ──

  ipcMain.handle(IPC.WEB_TRANSLATE_FETCH_ELEMENT_JS, async () => {
    try {
      const { net } = await import('electron');
      const resp = await net.fetch(
        'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit',
      );
      if (!resp.ok) return null;
      return await resp.text();
    } catch {
      return null;
    }
  });

  // ── 学习模块 ──

  ipcMain.handle(IPC.LEARNING_LOOKUP, (_e, word: string) =>
    lookupWord(word),
  );

  ipcMain.handle(IPC.LEARNING_TRANSLATE, (_e, text: string, targetLang?: string) =>
    googleTranslate(text, targetLang || 'zh-CN'),
  );

  ipcMain.handle(IPC.LEARNING_TTS, (_e, text: string, lang: string) =>
    googleTTS(text, lang),
  );

  ipcMain.handle(IPC.LEARNING_VOCAB_ADD, async (_e, word: string, definition: string, context?: string, phonetic?: string) => {
    const entry = await vocabStore.add(word, definition, context, phonetic);
    broadcastVocabChanged();
    return entry;
  });

  ipcMain.handle(IPC.LEARNING_VOCAB_REMOVE, async (_e, id: string) => {
    await vocabStore.remove(id);
    broadcastVocabChanged();
  });

  ipcMain.handle(IPC.LEARNING_VOCAB_LIST, () =>
    vocabStore.list(),
  );
  // ── AI Workflow ──

  // AI_ASK: Orchestrator / background mode (BackgroundAIWebview)
  ipcMain.handle(IPC.AI_ASK, async (_event, params: {
    serviceId: string;
    prompt: string;
    noteId?: string;
    thoughtId?: string;
  }) => {
    try {
      const { askAI } = await import('../../web-bridge/capabilities/ai-interaction');
      const result = await askAI(params.serviceId as any, params.prompt);
      return result;
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // AI_ASK_VISIBLE: User-facing mode — use Right Slot WebView
  // Opens Right Slot with WebView, waits for renderer to load,
  // then sends AI_INJECT_AND_SEND to the renderer.
  ipcMain.handle(IPC.AI_ASK_VISIBLE, async (_event, params: {
    serviceId: string;
    prompt: string;
    noteId: string;
    thoughtId: string;
    images?: string[];
  }) => {
    try {
      console.log('[AI_ASK_VISIBLE] Starting...', { serviceId: params.serviceId, promptLen: params.prompt.length, imageCount: params.images?.length ?? 0 });

      const mainWindow = getMainWindow();
      if (!mainWindow) return { success: false, error: 'No main window' };

      // 1. Open Right Slot with AI WebView (ai-web variant)
      const rightView = ctx.openCompanion('ai-web');
      console.log('[AI_ASK_VISIBLE] Step 1: openRightSlot result:', rightView ? 'OK' : 'null (toggle?)');
      if (!rightView) {
        const retryView = ctx.openCompanion('ai-web');
        console.log('[AI_ASK_VISIBLE] Step 1 retry:', retryView ? 'OK' : 'FAILED');
        if (!retryView) return { success: false, error: 'Failed to open Right Slot' };
      }

      // 2. Find the Right Slot's webContents
      const rightSlotIds = getActiveViewWebContentsIds();
      console.log('[AI_ASK_VISIBLE] Step 2: rightSlotIds =', rightSlotIds);
      if (!rightSlotIds || !rightSlotIds.rightId) {
        return { success: false, error: 'Right Slot not open after creation' };
      }

      const rightWC = (mainWindow as any).contentView.children.find(
        (v: any) => v.webContents?.id === rightSlotIds.rightId
      )?.webContents;

      if (!rightWC) {
        console.log('[AI_ASK_VISIBLE] Step 2: webContents NOT found for rightId =', rightSlotIds.rightId);
        return { success: false, error: 'Right Slot webContents not found' };
      }
      console.log('[AI_ASK_VISIBLE] Step 2: webContents found, id =', rightWC.id);

      // 3. Wait for the renderer to finish loading
      console.log('[AI_ASK_VISIBLE] Step 3: Waiting for renderer load... isLoading =', rightWC.isLoading());
      await new Promise<void>((resolve) => {
        if (!rightWC.isLoading()) {
          setTimeout(resolve, 1500);
        } else {
          rightWC.once('did-finish-load', () => {
            setTimeout(resolve, 1500);
          });
        }
      });
      console.log('[AI_ASK_VISIBLE] Step 3: Renderer ready, sending AI_INJECT_AND_SEND...');

      // 4. Send AI request to the Right Slot renderer
      return new Promise((resolve) => {
        const responseChannel = `ai:response:${params.thoughtId}`;
        let resolved = false;

        const listener = async (_e: any, result: any) => {
          if (resolved) return;
          resolved = true;
          ipcMain.removeListener(responseChannel, listener);
          console.log('[AI_ASK_VISIBLE] Step 4: Got response from renderer:', { success: result?.success, mdLen: result?.markdown?.length ?? 0, error: result?.error });

          // Renderer 侧已通过 extractTurnAt 获取完整 markdown（含 artifact/SVG/图片），
          // 这里只需要解析并保存到 ThoughtStore
          if (result?.success && result?.markdown) {
            try {
              const { ResultParser } = await import('../../web-bridge/pipeline/result-parser');
              const { createAtomsFromExtracted } = await import('../../web-bridge/pipeline/content-to-atoms');

              const parser = new ResultParser();
              const blocks = parser.parse(result.markdown);
              const atoms = createAtomsFromExtracted(blocks, '__skip_title__');

              const docAtom = atoms.find((a: any) => a.type === 'document');
              const docId = docAtom?.id;
              const contentAtoms = atoms.filter((a: any) => a.type !== 'document' && a.type !== 'noteTitle');
              for (const atom of contentAtoms) {
                if (atom.parentId === docId) atom.parentId = undefined;
              }

              await thoughtStore.save(params.thoughtId, { doc_content: contentAtoms });
              console.log('[AI_ASK_VISIBLE] Saved', contentAtoms.length, 'atoms to ThoughtStore');
            } catch (parseErr) {
              console.error('[AI_ASK_VISIBLE] Failed to parse AI response:', parseErr);
              await thoughtStore.save(params.thoughtId, {
                doc_content: [{
                  id: `atom-${Date.now()}`,
                  type: 'paragraph',
                  content: { children: [{ type: 'text', text: result.markdown }] },
                  meta: { createdAt: Date.now(), updatedAt: Date.now(), dirty: false },
                }],
              });
            }
          }

          resolve(result);
        };

        ipcMain.on(responseChannel, listener);

        console.log('[AI_ASK_VISIBLE] Step 4: Sending IPC.AI_INJECT_AND_SEND to rightWC id =', rightWC.id);
        rightWC.send(IPC.AI_INJECT_AND_SEND, {
          ...params,
          responseChannel,
        });

        // Timeout after 90 seconds
        setTimeout(() => {
          if (resolved) return;
          resolved = true;
          ipcMain.removeListener(responseChannel, listener);
          console.log('[AI_ASK_VISIBLE] Step 4: TIMEOUT after 90s');
          resolve({ success: false, error: 'AI response timed out (90s)' });
        }, 90_000);
      });
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.AI_STATUS, async () => {
    const { backgroundAI } = await import('../../web-bridge/capabilities/background-webview');
    return backgroundAI.getStatus();
  });

  // AI_READ_CLIPBOARD: Read system clipboard text (for Copy button extraction)
  ipcMain.handle(IPC.AI_READ_CLIPBOARD, async () => {
    const { clipboard } = await import('electron');
    return clipboard.readText();
  });

  // WB_CAPTURE_DOWNLOAD_ONCE: Arm a one-shot will-download handler on the
  // sender's guest webContents session. The NEXT download triggered on
  // that session is intercepted: saved to a temp path, read into memory,
  // deleted, and returned to the caller as raw bytes (base64).
  //
  // Returning base64 (not a UTF-8 string) preserves original bytes — critical
  // because Claude's SVG downloads have a latin1/utf-8 encoding bug that
  // callers need to reverse; if we decode as UTF-8 here, the original bytes
  // are lost and the bug can't be fixed. Binary downloads (PNG) also need
  ipcMain.handle(IPC.WB_CAPTURE_DOWNLOAD_ONCE, async (event, timeoutMs?: number) => {
    try {
      const { getGuest } = await import('../../web-bridge/infrastructure/guest-registry');
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');

      const guest = getGuest(event.sender.id);
      if (!guest) return { success: false, error: 'no guest for sender' };
      const session = guest.session;

      return await new Promise<{
        success: boolean;
        filename?: string;
        mimeType?: string;
        /** base64-encoded raw bytes of the downloaded file */
        contentBase64?: string;
        byteLength?: number;
        error?: string;
      }>((resolve) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-artifact-'));
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          session.removeListener('will-download', listener);
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          resolve({ success: false, error: 'timeout waiting for download' });
        }, timeoutMs ?? 10_000);

        const listener = (_ev: Electron.Event, item: Electron.DownloadItem) => {
          // One-shot: detach immediately so later downloads behave normally.
          session.removeListener('will-download', listener);

          const filename = item.getFilename();
          const mimeType = item.getMimeType();
          const savePath = path.join(tmpDir, filename);
          item.setSavePath(savePath);

          item.on('done', (_e, state) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (state === 'completed') {
              try {
                const buf = fs.readFileSync(savePath);
                resolve({
                  success: true,
                  filename,
                  mimeType,
                  contentBase64: buf.toString('base64'),
                  byteLength: buf.length,
                });
              } catch (err) {
                resolve({ success: false, error: 'read failed: ' + String(err) });
              }
            } else {
              resolve({ success: false, error: 'download ' + state });
            }
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          });
        };
        session.on('will-download', listener);
      });
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // WB_FETCH_BINARY: fetch a URL from the main process and return the body
  // as base64. Used to download assets that the renderer can't fetch itself
  // because of CORS (e.g. Gemini's lh3.googleusercontent.com Imagen outputs,
  // which reject cross-origin fetch and also fail img.onerror under
  // crossOrigin="anonymous"). Main-process net.fetch has no CORS.
  ipcMain.handle(IPC.WB_FETCH_BINARY, async (_event, params: {
    url: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  }) => {
    try {
      const { net } = await import('electron');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 15_000);
      try {
        const resp = await net.fetch(params.url, {
          method: 'GET',
          headers: params.headers,
          redirect: 'follow',
          signal: controller.signal,
        });
        if (!resp.ok) return { success: false, error: `http ${resp.status}` };
        const buf = Buffer.from(await resp.arrayBuffer());
        const mimeType = resp.headers.get('content-type') || 'application/octet-stream';
        return {
          success: true,
          base64: buf.toString('base64'),
          mimeType: mimeType.split(';')[0].trim(),
          bodyLength: buf.length,
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.WB_CAPTURE_ISOLATED_SEGMENT, async (_event, url: string, timeoutMs?: number) => {
    let win: BrowserWindow | null = null;
    try {
      if (!url || !/^https:\/\/a\.claude\.ai\/isolated-segment\.html/i.test(url)) {
        return { success: false, error: 'invalid-isolated-segment-url' };
      }

      const webSession = session.fromPartition(WEBVIEW_PARTITION);
      webSession.webRequest.onHeadersReceived((details, callback) => {
        const headers = { ...details.responseHeaders };
        delete headers['content-security-policy'];
        delete headers['Content-Security-Policy'];
        delete headers['content-security-policy-report-only'];
        delete headers['Content-Security-Policy-Report-Only'];
        callback({ responseHeaders: headers });
      });

      win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 2200,
        webPreferences: {
          partition: WEBVIEW_PARTITION,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
        },
      });

      await win.loadURL(url);
      const deadline = Date.now() + Math.max(4000, Math.min(timeoutMs ?? 9000, 15000));
      let visibleFrames: Array<{ src: string; x: number; y: number; width: number; height: number }> = [];

      while (Date.now() < deadline) {
        const r = await win.webContents.executeJavaScript(`
          (function() {
            return Array.from(document.querySelectorAll('iframe')).map(function(el) {
              var src = String(el.getAttribute('src') || el.src || '');
              var rect = el.getBoundingClientRect();
              return {
                src: src,
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              };
            }).filter(function(item) {
              return item.src.indexOf('claudemcpcontent.com/mcp_apps') >= 0 && item.width > 20 && item.height > 20;
            });
          })()
        `);
        if (Array.isArray(r) && r.length > 0) {
          visibleFrames = r;
          break;
        }
        await new Promise(r => setTimeout(r, 250));
      }

      if (!visibleFrames.length) {
        return { success: false, error: 'no-visible-mcp-iframes' };
      }

      const items: Array<{ index: number; src: string; mimeType: string; contentBase64: string; width: number; height: number }> = [];
      for (let i = 0; i < visibleFrames.length; i++) {
        const f = visibleFrames[i];
        const img = await win.webContents.capturePage({
          x: Math.max(0, f.x),
          y: Math.max(0, f.y),
          width: Math.max(1, f.width),
          height: Math.max(1, f.height),
        });
        items.push({
          index: i,
          src: f.src,
          mimeType: 'image/png',
          contentBase64: img.toPNG().toString('base64'),
          width: f.width,
          height: f.height,
        });
      }

      return { success: true, items };
    } catch (err) {
      return { success: false, error: String(err) };
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
    }
  });

  ipcMain.handle(IPC.WB_CAPTURE_GUEST_RECTS, async (event, rects: Array<{ x: number; y: number; width: number; height: number }>) => {
    try {
      const { getGuest } = await import('../../web-bridge/infrastructure/guest-registry');
      const guest = getGuest(event.sender.id);
      if (!guest) return { success: false, error: 'no guest for sender' };
      const items: Array<{ index: number; mimeType: string; contentBase64: string; width: number; height: number }> = [];
      for (let i = 0; i < (Array.isArray(rects) ? rects.length : 0); i++) {
        const r = rects[i];
        const img = await guest.capturePage({
          x: Math.max(0, Math.round(r.x)),
          y: Math.max(0, Math.round(r.y)),
          width: Math.max(1, Math.round(r.width)),
          height: Math.max(1, Math.round(r.height)),
        });
        items.push({
          index: i,
          mimeType: 'image/png',
          contentBase64: img.toPNG().toString('base64'),
          width: Math.round(r.width),
          height: Math.round(r.height),
        });
      }
      return { success: true, items };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.BROWSER_CAPABILITY_DOWNLOAD_CLAUDE_ARTIFACTS, async (event) => {
    try {
      const { getGuest } = await import('../../web-bridge/infrastructure/guest-registry');
      const guest = getGuest(event.sender.id);
      if (!guest) return { success: false, error: 'no guest for sender' };

      const pageId = getPageIdForWebContents(guest);
      if (!pageId) return { success: false, error: 'guest page not bound' };

      const readinessDeadline = Date.now() + 8_000;
      let artifacts = browserCapabilityTraceWriter.getArtifacts(pageId)
        .filter((artifact) => artifact.acquisition === 'downloadable');
      while (
        artifacts.length === 0 &&
        !browserCapabilityTraceWriter.hasExtractedFile(pageId, 'conversation.json') &&
        Date.now() < readinessDeadline
      ) {
        await sleep(400);
        artifacts = browserCapabilityTraceWriter.getArtifacts(pageId)
          .filter((artifact) => artifact.acquisition === 'downloadable');
      }

      if (artifacts.length === 0) {
        const hasConversation = browserCapabilityTraceWriter.hasExtractedFile(pageId, 'conversation.json');
        return {
          success: true,
          pageId,
          attempted: 0,
          completed: 0,
          downloads: [],
          reason: hasConversation ? 'no-downloadable-artifacts' : 'artifacts-not-ready',
        };
      }

      const downloads: Array<{
        artifactId: string;
        filename?: string;
        status: 'completed' | 'failed' | 'cancelled' | 'timeout';
        storageRef?: string;
        error?: string;
      }> = [];

      for (const artifact of artifacts) {
        try {
          const download = await browserArtifactService.downloadAttachment(pageId, artifact.artifactId);
          downloads.push({
            artifactId: artifact.artifactId,
            filename: download?.filename,
            status: download?.status === 'completed' || download?.status === 'failed' || download?.status === 'cancelled'
              ? download.status
              : 'timeout',
            storageRef: download?.storageRef,
          });
        } catch (error) {
          downloads.push({
            artifactId: artifact.artifactId,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        success: true,
        pageId,
        attempted: artifacts.length,
        completed: downloads.filter((entry) => entry.status === 'completed').length,
        downloads,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC.BROWSER_CAPABILITY_DEBUG_LOG, async (event, payload: unknown) => {
    try {
      const { getGuest } = await import('../../web-bridge/infrastructure/guest-registry');
      const guest = getGuest(event.sender.id);
      if (!guest) return { success: false, error: 'no guest for sender' };
      const pageId = getPageIdForWebContents(guest);
      if (!pageId) return { success: false, error: 'guest page not bound' };
      browserCapabilityTraceWriter.writeDebugLog(pageId, 'artifact-download', payload);
      return { success: true, pageId };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // BROWSER_CAPABILITY_EXTRACT_TURN: extract a single turn from conversation data (Claude / ChatGPT)
  ipcMain.handle(IPC.BROWSER_CAPABILITY_EXTRACT_TURN, async (event, params: { msgIndex: number }) => {
    try {
      const { getGuest } = await import('../../web-bridge/infrastructure/guest-registry');
      const guest = getGuest(event.sender.id);
      if (!guest) return { success: false, error: 'no guest for sender' };
      const pageId = getPageIdForWebContents(guest);
      if (!pageId) return { success: false, error: 'guest page not bound' };

      const { browserCapabilityTraceWriter } = await import('../../browser-capability/persistence');
      const kind = browserCapabilityTraceWriter.getConversationKind(pageId);

      if (kind === 'chatgpt-conversation') {
        const { extractChatGPTTurn } = await import('../../browser-capability/artifact/chatgpt-extract-turn');
        const result = await extractChatGPTTurn(pageId, params.msgIndex);
        if (!result) return { success: false, error: 'no chatgpt conversation data or turn not found' };
        return { success: true, ...result };
      } else {
        const { extractTurn } = await import('../../browser-capability/artifact/extract-turn');
        const result = await extractTurn(pageId, params.msgIndex);
        if (!result) return { success: false, error: 'no conversation data or message not found' };
        return { success: true, ...result };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // BROWSER_CAPABILITY_EXTRACT_FULL: extract full conversation (Claude / ChatGPT)
  ipcMain.handle(IPC.BROWSER_CAPABILITY_EXTRACT_FULL, async (event) => {
    try {
      const { getGuest } = await import('../../web-bridge/infrastructure/guest-registry');
      const guest = getGuest(event.sender.id);
      if (!guest) return { success: false, error: 'no guest for sender' };
      const pageId = getPageIdForWebContents(guest);
      if (!pageId) return { success: false, error: 'guest page not bound' };

      const { browserCapabilityTraceWriter } = await import('../../browser-capability/persistence');
      const kind = browserCapabilityTraceWriter.getConversationKind(pageId);

      if (kind === 'chatgpt-conversation') {
        const { extractChatGPTFullConversation } = await import('../../browser-capability/artifact/chatgpt-extract-turn');
        const result = await extractChatGPTFullConversation(pageId);
        if (!result) return { success: false, error: 'no chatgpt conversation data' };
        return { success: true, ...result };
      } else {
        const { extractFullConversation } = await import('../../browser-capability/artifact/extract-turn');
        const result = await extractFullConversation(pageId);
        if (!result) return { success: false, error: 'no conversation data' };
        return { success: true, ...result };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // BROWSER_CAPABILITY_PROBE_CONVERSATION: 强制重新 fetch conversation API（Claude / ChatGPT 自动路由）
  ipcMain.handle(IPC.BROWSER_CAPABILITY_PROBE_CONVERSATION, async (event) => {
    try {
      const { getGuest } = await import('../../web-bridge/infrastructure/guest-registry');
      const guest = getGuest(event.sender.id);
      if (!guest) return { success: false, error: 'no guest for sender' };
      const { browserCapabilityServices } = await import('../../browser-capability/main-service');
      const guestUrl = guest.getURL?.() || '';
      if (guestUrl.includes('chatgpt.com') || guestUrl.includes('chat.openai.com')) {
        await browserCapabilityServices.probeChatGPTConversation(guest, true);
      } else {
        await browserCapabilityServices.probeClaudeConversation(guest, true);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // WB_READ_CLIPBOARD_IMAGE: Read clipboard as PNG data URL.
  // Claude "Copy to clipboard" on an Artifact writes the rendered image, not source.
  ipcMain.handle(IPC.WB_READ_CLIPBOARD_IMAGE, async () => {
    const { clipboard } = await import('electron');
    const img = clipboard.readImage();
    if (img.isEmpty()) return { success: false, empty: true };
    const size = img.getSize();
    return {
      success: true,
      dataUrl: img.toDataURL(),
      width: size.width,
      height: size.height,
    };
  });

  // ── WebBridge CDP Interceptor (Debug) ──
  // Attach Chrome DevTools Protocol to the sender's guest webview and capture network responses.
  // Used to inspect Claude Artifact API traffic and any other server responses.
  let cdpInstance: any = null;

  ipcMain.handle(IPC.WB_CDP_START, async (event, urlFilters?: string[]) => {
    try {
      const { getGuest } = await import('../../web-bridge/infrastructure/guest-registry');
      const { CDPInterceptor } = await import('../../web-bridge/capabilities/cdp-interceptor');

      const senderId = event.sender.id;
      const guest = getGuest(senderId);
      if (!guest) {
        return { success: false, error: 'No guest webview found for sender ' + senderId };
      }

      // Stop previous instance if any
      if (cdpInstance) {
        cdpInstance.stop();
        cdpInstance = null;
      }

      const filters = (urlFilters || []).map(f => f.startsWith('/') && f.endsWith('/') ? new RegExp(f.slice(1, -1)) : f);
      cdpInstance = new CDPInterceptor(guest, {
        urlFilters: filters,
        maxCacheSize: 200,
        captureBodies: true,
      });
      const ok = cdpInstance.start();
      return {
        success: ok,
        guestUrl: guest.getURL(),
        guestId: guest.id,
        filters: urlFilters || [],
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // WB_SEND_MOUSE: synthesize native mouse events into the sender's guest webview
  // via CDP (Input.dispatchMouseEvent). Used to trigger Radix UI hover menus
  // (e.g. Claude Artifact "..." menu) that don't respond to JS-layer dispatchEvent.
  ipcMain.handle(IPC.WB_SEND_MOUSE, async (event, events: Array<{
    type: string; x: number; y: number;
    button?: string; buttons?: number; clickCount?: number;
  }>) => {
    try {
      const { getGuest } = await import('../../web-bridge/infrastructure/guest-registry');
      const senderId = event.sender.id;
      const guest = getGuest(senderId);
      if (!guest) return { success: false, error: 'No guest for sender ' + senderId };

      // Attach debugger if not already attached. Safe to call repeatedly;
      // if another debugger is attached we silently ignore.
      const dbg = guest.debugger;
      if (!dbg.isAttached()) {
        try { dbg.attach('1.3'); } catch (e) { /* another debugger may be attached */ }
      }

      for (const ev of events) {
        await dbg.sendCommand('Input.dispatchMouseEvent', {
          type: ev.type,
          x: ev.x,
          y: ev.y,
          button: ev.button ?? 'none',
          buttons: ev.buttons ?? 0,
          clickCount: ev.clickCount ?? 0,
          pointerType: 'mouse',
        });
      }
      return { success: true, count: events.length };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // WB_SEND_KEY: synthesize native key events into the sender's guest webview
  // via CDP (Input.dispatchKeyEvent). Used for browser-layer UI such as
  // download confirmation bubbles that aren't part of the page DOM.
  ipcMain.handle(IPC.WB_SEND_KEY, async (event, events: Array<{
    type: string;
    key: string;
    code?: string;
    windowsVirtualKeyCode?: number;
  }>) => {
    try {
      const { getGuest } = await import('../../web-bridge/infrastructure/guest-registry');
      const senderId = event.sender.id;
      const guest = getGuest(senderId);
      if (!guest) return { success: false, error: 'No guest for sender ' + senderId };

      const dbg = guest.debugger;
      if (!dbg.isAttached()) {
        try { dbg.attach('1.3'); } catch (e) { /* another debugger may be attached */ }
      }

      for (const ev of events) {
        await dbg.sendCommand('Input.dispatchKeyEvent', {
          type: ev.type,
          key: ev.key,
          code: ev.code ?? ev.key,
          windowsVirtualKeyCode: ev.windowsVirtualKeyCode ?? 0,
          nativeVirtualKeyCode: ev.windowsVirtualKeyCode ?? 0,
        });
      }
      return { success: true, count: events.length };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.WB_CDP_STOP, async () => {
    if (cdpInstance) {
      cdpInstance.stop();
      cdpInstance = null;
    }
    return { success: true };
  });

  ipcMain.handle(IPC.WB_CDP_GET_RESPONSES, async () => {
    if (!cdpInstance) return { success: false, error: 'CDP not started', responses: [] };
    const responses = cdpInstance.getResponses();
    // Return truncated body previews to avoid massive IPC payloads
    const preview = responses.map((r: any) => ({
      requestId: r.requestId,
      url: r.url,
      statusCode: r.statusCode,
      mimeType: r.mimeType,
      bodyLength: r.body?.length ?? 0,
      bodyPreview: r.body?.slice(0, 2000) ?? null,
      timestamp: r.timestamp,
    }));
    return { success: true, count: responses.length, responses: preview };
  });

  // WB_CDP_FIND_RESPONSE: Return full bodies of captured CDP responses
  // matching a URL substring. Used by content extractors (e.g. ChatGPT)
  // that need the raw JSON / base64 payload rather than a 2KB preview.
  //
  // `urlSubstring`: case-sensitive substring match against response URL.
  // `mode`:
  //   'all'    → every match, in capture order (default)
  //   'latest' → only the most recent match
  //   'first'  → only the earliest match
  ipcMain.handle(IPC.WB_CDP_FIND_RESPONSE, async (_event, params: {
    urlSubstring: string;
    mode?: 'all' | 'latest' | 'first';
  }) => {
    if (!cdpInstance) return { success: false, error: 'CDP not started', matches: [] };
    const all = cdpInstance.getResponses().filter((r: any) => r.url.includes(params.urlSubstring));
    let picked = all;
    if (params.mode === 'latest') picked = all.slice(-1);
    else if (params.mode === 'first') picked = all.slice(0, 1);
    return {
      success: true,
      count: picked.length,
      matches: picked.map((r: any) => ({
        url: r.url, statusCode: r.statusCode, mimeType: r.mimeType,
        body: r.body, bodyLength: r.body?.length ?? 0, timestamp: r.timestamp,
      })),
    };
  });

  ipcMain.handle(IPC.AI_PARSE_MARKDOWN, async (_event, markdown: string) => {
    try {
      const { ResultParser } = await import('../../web-bridge/pipeline/result-parser');
      const { createAtomsFromExtracted } = await import('../../web-bridge/pipeline/content-to-atoms');

      const parser = new ResultParser();
      const blocks = parser.parse(markdown);
      // Pass a title to prevent createAtomsFromExtracted from consuming the first heading
      const atoms = createAtomsFromExtracted(blocks, '__skip_title__');

      // Remove document root + noteTitle — only content atoms needed
      const docAtom = atoms.find((a: any) => a.type === 'document');
      const docId = docAtom?.id;
      const contentAtoms = atoms.filter((a: any) => a.type !== 'document' && a.type !== 'noteTitle');
      for (const atom of contentAtoms) {
        if (atom.parentId === docId) atom.parentId = undefined;
      }

      return { success: true, atoms: contentAtoms };
    } catch (err) {
      console.error('[AI_PARSE_MARKDOWN] Error:', err);
      return { success: false, error: String(err), atoms: [] };
    }
  });

  ipcMain.handle(IPC.AI_EXTRACTION_CACHE_WRITE, async (_event, payload: {
    extractionId?: string;
    stage?: string;
    serviceId?: string;
    url?: string;
    noteTitle?: string;
    msgIndex?: number;
    preview?: string;
    userMessage?: string;
    markdown?: string;
    meta?: Record<string, unknown>;
  }) => {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      const cacheDir = path.join(process.cwd(), 'debug', 'ai-extraction-cache');
      await fs.mkdir(cacheDir, { recursive: true });

      const extractionId = String(payload.extractionId || Date.now());
      const stage = String(payload.stage || 'snapshot');
      const serviceId = String(payload.serviceId || 'unknown');
      const safeId = extractionId.replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeStage = stage.replace(/[^a-zA-Z0-9._-]/g, '_');
      const baseName = `${safeId}-${safeStage}`;

      const record = {
        extractionId,
        stage,
        serviceId,
        writtenAt: new Date().toISOString(),
        ...payload,
      };

      const jsonPath = path.join(cacheDir, `${baseName}.json`);
      await fs.writeFile(jsonPath, JSON.stringify(record, null, 2), 'utf8');

      let markdownPath: string | null = null;
      if (typeof payload.markdown === 'string') {
        markdownPath = path.join(cacheDir, `${baseName}.md`);
        await fs.writeFile(markdownPath, payload.markdown, 'utf8');
      }

      await fs.writeFile(
        path.join(cacheDir, `latest-${serviceId}.json`),
        JSON.stringify(record, null, 2),
        'utf8',
      );
      if (typeof payload.markdown === 'string') {
        await fs.writeFile(
          path.join(cacheDir, `latest-${serviceId}.md`),
          payload.markdown,
          'utf8',
        );
      }

      return { success: true, dir: cacheDir, jsonPath, markdownPath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // AI_EXTRACT_DEBUG: Parse markdown and return stats (for debugging extraction quality)
  ipcMain.handle(IPC.AI_EXTRACT_DEBUG, async (_event, params: { markdown: string; serviceId: string }) => {
    try {
      const { ResultParser } = await import('../../web-bridge/pipeline/result-parser');
      const { createAtomsFromExtracted } = await import('../../web-bridge/pipeline/content-to-atoms');

      const parser = new ResultParser();
      const blocks = parser.parse(params.markdown);

      console.log('[AI_EXTRACT_DEBUG] Parsed blocks:', blocks.length);

      // Build detailed block info for the debug panel
      const blockDetails = blocks.map((b: any, i: number) => {
        const info: any = { index: i, type: b.type, textLength: b.text?.length ?? 0 };
        if (b.language) info.language = b.language;
        if (b.headingLevel) info.headingLevel = b.headingLevel;
        if (b.src) info.src = b.src;
        if (b.items) info.itemCount = b.items.length;
        if (b.tableRows) info.rows = b.tableRows.length;
        if (b.inlines) info.inlineCount = b.inlines.length;
        info.textPreview = b.text?.slice(0, 120) || '';
        console.log(`  [${i}] ${b.type}${b.language ? `(${b.language})` : ''}: "${info.textPreview.slice(0, 60)}"`);
        return info;
      });

      const atoms = createAtomsFromExtracted(blocks);
      const contentAtoms = atoms.filter((a: any) => a.type !== 'document' && a.type !== 'noteTitle');

      const docAtom = atoms.find((a: any) => a.type === 'document');
      const docId = docAtom?.id;
      for (const atom of contentAtoms) {
        if (atom.parentId === docId) atom.parentId = undefined;
      }

      console.log('[AI_EXTRACT_DEBUG] Content atoms:', contentAtoms.length);
      const atomDetails = contentAtoms.map((a: any, i: number) => {
        const info: any = { index: i, type: a.type, id: a.id?.slice(0, 15) };
        if (a.parentId) info.parentId = a.parentId.slice(0, 15);
        // Extract text preview from content
        const content = a.content as any;
        if (content?.children) {
          const parts = content.children.map((c: any) => {
            if (c.type === 'text') return c.text || '';
            if (c.type === 'math-inline') return `$${c.latex}$`;
            if (c.type === 'code-inline') return `\`${c.code}\``;
            if (c.type === 'link') return `[${c.children?.map((ch: any) => ch.text).join('') || ''}](${c.href})`;
            return `[${c.type}]`;
          }).join('');
          info.textPreview = parts.slice(0, 120);
          info.inlineTypes = content.children.map((c: any) => c.type);
        } else if (content?.latex) {
          info.textPreview = `[LaTeX] ${content.latex.slice(0, 60)}`;
        } else if (content?.language) {
          info.textPreview = `[Code:${content.language}]`;
        } else if (content?.src) {
          info.textPreview = `[Image] ${content.src.slice(0, 60)}`;
        }
        return info;
      });

      return {
        success: true,
        blocks: blocks.length,
        atomCount: contentAtoms.length,
        preview: JSON.stringify(contentAtoms[0]?.content).slice(0, 200),
        blockTypes: blocks.map((b: any) => b.type),
        atomTypes: contentAtoms.map((a: any) => a.type),
        blockDetails,
        atomDetails,
      };
    } catch (err) {
      console.error('[AI_EXTRACT_DEBUG] Error:', err);
      return { success: false, error: String(err) };
    }
  });
  // ── Tweet 数据获取 ──

  // ── yt-dlp ──

  ipcMain.handle(IPC.YTDLP_CHECK_STATUS, async () => {
    return ytdlpCheckStatus();
  });

  ipcMain.handle(IPC.YTDLP_INSTALL, async (event) => {
    try {
      const status = await ytdlpInstall((percent) => {
        // 发送安装进度到 renderer
        event.sender.send(IPC.YTDLP_PROGRESS, { url: '', status: 'downloading', percent });
      });
      return { success: true, status };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.YTDLP_DOWNLOAD, async (event, url: string) => {
    try {
      // 1. 先获取视频标题（用于默认文件名）
      const info = await getVideoInfo(url);
      const defaultTitle = (info?.title as string) || 'video';
      const safeTitle = defaultTitle.replace(/[/\\?%*:|"<>]/g, '_');

      // 2. 弹出保存对话框
      const mainWindow = getMainWindow();
      const dialogResult = await dialog.showSaveDialog(mainWindow as any, {
        defaultPath: `${safeTitle}.mp4`,
        filters: [
          { name: 'MP4 Video', extensions: ['mp4'] },
          { name: 'WebM Video', extensions: ['webm'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (dialogResult.canceled || !dialogResult.filePath) {
        return { url, status: 'error', percent: 0, error: 'Download canceled' };
      }

      // 3. 用用户选择的路径下载
      const result = await downloadVideo(url, (progress) => {
        event.sender.send(IPC.YTDLP_PROGRESS, progress);
      }, dialogResult.filePath);
      return result;
    } catch (err) {
      return { url, status: 'error', percent: 0, error: String(err) };
    }
  });

  ipcMain.handle(IPC.YTDLP_SAVE_SUBTITLE, (_e, videoFilePath: string, langCode: string, timestampText: string) => {
    try {
      const srtPath = saveTranslationSubtitle(videoFilePath, langCode, timestampText);
      return { success: true, path: srtPath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.YTDLP_GET_INFO, async (_e, url: string) => {
    const info = await getVideoInfo(url);
    return info ? { success: true, info } : { success: false, error: 'Failed to get info' };
  });

  // ── YouTube 字幕 ──

  ipcMain.handle(IPC.YOUTUBE_TRANSCRIPT, async (_e, videoUrl: string) => {
    return fetchYouTubeTranscript(videoUrl);
  });

  ipcMain.handle(IPC.TWEET_FETCH_DATA, async (_e, tweetUrl: string) => {
    return fetchTweetData(tweetUrl);
  });

  ipcMain.handle(IPC.TWEET_FETCH_OEMBED, async (_e, tweetUrl: string) => {
    try {
      const encodedUrl = encodeURIComponent(tweetUrl);
      const oembedUrl = `https://publish.twitter.com/oembed?url=${encodedUrl}&theme=dark&dnt=true&omit_script=false`;
      const response = await net.fetch(oembedUrl);
      if (!response.ok) return { success: false, error: `oEmbed API returned ${response.status}` };
      const data = await response.json();
      return { success: true, html: data.html || '' };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
  // ── Web 书签 ──

  ipcMain.handle(IPC.WEB_BOOKMARK_LIST, async () => {
    return webBookmarkStore.list();
  });

  ipcMain.handle(IPC.WEB_BOOKMARK_ADD, async (_event, url: string, title: string, favicon?: string) => {
    return webBookmarkStore.add(url, title, favicon);
  });

  ipcMain.handle(IPC.WEB_BOOKMARK_REMOVE, async (_event, id: string) => {
    await webBookmarkStore.remove(id);
  });

  ipcMain.handle(IPC.WEB_BOOKMARK_UPDATE, async (_event, id: string, fields: { title?: string; url?: string; favicon?: string }) => {
    await webBookmarkStore.update(id, fields);
  });

  ipcMain.handle(IPC.WEB_BOOKMARK_MOVE, async (_event, id: string, folderId: string | null) => {
    await webBookmarkStore.move(id, folderId);
  });

  ipcMain.handle('web:bookmark-find-by-url', async (_event, url: string) => {
    return webBookmarkStore.findByUrl(url);
  });

  // Web 书签文件夹
  ipcMain.handle(IPC.WEB_FOLDER_CREATE, async (_event, title: string) => {
    return webBookmarkStore.folderCreate(title);
  });

  ipcMain.handle(IPC.WEB_FOLDER_RENAME, async (_event, id: string, title: string) => {
    await webBookmarkStore.folderRename(id, title);
  });

  ipcMain.handle(IPC.WEB_FOLDER_DELETE, async (_event, id: string) => {
    await webBookmarkStore.folderDelete(id);
  });

  ipcMain.handle(IPC.WEB_FOLDER_LIST, async () => {
    return webBookmarkStore.folderList();
  });

  // Web 浏览历史
  ipcMain.handle(IPC.WEB_HISTORY_ADD, async (_event, url: string, title: string, favicon?: string) => {
    return webHistoryStore.add(url, title, favicon);
  });

  ipcMain.handle(IPC.WEB_HISTORY_LIST, async (_event, limit?: number) => {
    return webHistoryStore.list(limit);
  });

  ipcMain.handle(IPC.WEB_HISTORY_CLEAR, async () => {
    await webHistoryStore.clear();
  });

  // ── PDF Extraction (Platform) ──

  ipcMain.handle(IPC.EXTRACTION_OPEN, async () => {
    console.log('[Extraction] EXTRACTION_OPEN handler triggered');

    // 1. 打开 ExtractionView 到 Right Slot（加载 Platform Web UI）
    ctx.openCompanion('extraction');

    // 2. 并行上传当前 PDF 到 Platform
    const ebookData = getEBookData();
    if (!ebookData) {
      return { uploaded: false, reason: 'no-file' };
    }
    if (!ebookData.filePath.toLowerCase().endsWith('.pdf')) {
      return { uploaded: false, reason: 'not-pdf' };
    }

    // 从书架获取显示名（而非 UUID 文件名）
    const allEntries = await bookshelfStore.list();
    const entry = allEntries.find((e) => e.filePath === ebookData.filePath);
    const displayName = entry?.displayName || ebookData.fileName.replace(/\.pdf$/i, '');
    console.log('[Extraction] Uploading:', displayName, `(${ebookData.filePath})`);

    try {
      const { uploadPdfToPlatform } = await import('../../../main/extraction/upload-service');
      const result = await uploadPdfToPlatform(ebookData.filePath, displayName);

      // 上传完成后，通知 ExtractionView 导航到书籍详情页
      const mainWindow = getMainWindow();
      if (mainWindow) {
        for (const view of mainWindow.contentView.children) {
          if ('webContents' in view) {
            (view as any).webContents.send('extraction:navigate', result.md5);
          }
        }
      }

      return { uploaded: true, md5: result.md5, alreadyExists: result.alreadyExists };
    } catch (err) {
      console.error('[Extraction] Upload failed:', err);
      return { uploaded: false, reason: String(err) };
    }
  });

  ipcMain.handle(IPC.EXTRACTION_IMPORT, async (_event, data: any) => {
    try {
      const { importExtractionData } = await import('../../../main/extraction/import-service');

      // 批次格式：{ type: 'batch', chapters: [{ bookName, title, pageStart, pageEnd, pages }] }
      // 从第一个 chapter 提取 bookName
      if (data.type === 'batch' && !data.bookName && data.chapters?.[0]?.bookName) {
        data.bookName = data.chapters[0].bookName;
      }

      // 附加当前打开的 bookId（用于建立 Graph 关系）
      const active = workspaceManager.getActive();
      if (active?.activeBookId && !data.bookId) {
        data.bookId = active.activeBookId;
      }

      const result = await importExtractionData(data);

      // 广播列表变更（让 NavSide 立即刷新文件夹/笔记树）
      broadcastContentTree();

      // 有新笔记时，跳转到最新导入的笔记
      if (result.noteId) {
        setPendingNoteId(result.noteId);
        ctx.openCompanion('demo-a');
      }

      return { success: true, ...result };
    } catch (err) {
      console.error('[Extraction] Import failed:', err);
      return { success: false, error: String(err) };
    }
  });

// ── Helper Functions ──

async function fetchYouTubeTranscript(videoUrl: string): Promise<{
  success: boolean;
  transcript?: string;
  error?: string;
}> {
  try {
    const { fetchTranscript } = await import('youtube-transcript');
    const segments = await fetchTranscript(videoUrl);
    if (!segments || segments.length === 0) {
      return { success: false, error: 'No transcript available for this video' };
    }
    // 转为 { time, text } 格式（offset 是毫秒）
    const result = segments.map((seg: { text: string; offset: number }) => ({
      time: Math.floor(seg.offset / 1000),
      text: seg.text,
    }));
    return { success: true, transcript: JSON.stringify(result) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ═══════════════════════════════════════════════════════════
// Tweet 数据提取
// ═══════════════════════════════════════════════════════════

/** 隐藏 BrowserWindow + DOM 提取脚本获取推文结构化数据 */
async function fetchTweetData(tweetUrl: string): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      width: 800, height: 900, show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    await win.loadURL(tweetUrl);

    // 等待 Twitter SPA 渲染（轮询最多 10 秒）
    let rendered = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const hasArticle = await win.webContents.executeJavaScript(
        'document.querySelector(\'article[data-testid="tweet"]\') !== null'
      );
      if (hasArticle) { rendered = true; break; }
    }
    if (!rendered) return { success: false, error: 'Tweet page did not render in time' };

    // 执行 DOM 提取
    const data = await win.webContents.executeJavaScript(EXTRACT_TWEET_JS);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: String(err) };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}

/** DOM 提取脚本 — 基于 data-testid 属性 */
const EXTRACT_TWEET_JS = `
(function() {
  const result = {};
  try {
    // 找到主推文 article
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const article = articles[0];
    if (!article) return result;

    // 作者信息
    try {
      const userNameEl = article.querySelector('[data-testid="User-Name"]');
      if (userNameEl) {
        const spans = userNameEl.querySelectorAll('span');
        for (const span of spans) {
          const text = span.textContent || '';
          if (text.startsWith('@')) result.authorHandle = text;
          else if (text.length > 1 && !text.startsWith('@') && !text.includes('·')) {
            if (!result.authorName) result.authorName = text;
          }
        }
      }
    } catch {}

    // 头像
    try {
      const avatarImg = article.querySelector('[data-testid="Tweet-User-Avatar"] img');
      if (avatarImg) result.authorAvatar = avatarImg.src;
    } catch {}

    // 推文正文
    try {
      const tweetText = article.querySelector('[data-testid="tweetText"]');
      if (tweetText) {
        result.text = tweetText.textContent || '';
        result.lang = tweetText.getAttribute('lang') || '';
      }
    } catch {}

    // 时间
    try {
      const timeEl = article.querySelector('time');
      if (timeEl) result.createdAt = timeEl.getAttribute('datetime') || '';
    } catch {}

    // 图片媒体
    try {
      const photos = article.querySelectorAll('[data-testid="tweetPhoto"] img');
      if (photos.length > 0) {
        result.media = [];
        photos.forEach(img => {
          result.media.push({ type: 'image', url: img.src });
        });
      }
    } catch {}

    // 视频媒体
    try {
      const videos = article.querySelectorAll('video');
      videos.forEach(v => {
        if (!result.media) result.media = [];
        result.media.push({ type: 'video', url: v.src || '', thumbUrl: v.poster || '' });
      });
    } catch {}

    // 互动数据
    try {
      const group = article.querySelector('[role="group"]');
      if (group) {
        const buttons = group.querySelectorAll('[data-testid]');
        const metrics = {};
        buttons.forEach(btn => {
          const testId = btn.getAttribute('data-testid') || '';
          const numSpan = btn.querySelector('span[data-testid]') || btn.querySelector('span');
          const numText = numSpan ? numSpan.textContent.trim() : '';
          const num = parseMetricNumber(numText);
          if (testId.includes('reply')) metrics.replies = num;
          if (testId.includes('retweet')) metrics.retweets = num;
          if (testId.includes('like')) metrics.likes = num;
        });
        // 浏览量
        try {
          const analyticsLink = article.querySelector('a[href*="/analytics"]');
          if (analyticsLink) {
            const viewSpan = analyticsLink.querySelector('span');
            if (viewSpan) metrics.views = parseMetricNumber(viewSpan.textContent.trim());
          }
        } catch {}
        if (Object.keys(metrics).length > 0) result.metrics = metrics;
      }
    } catch {}

    // 引用推文
    try {
      const quote = article.querySelector('[data-testid="quoteTweet"]');
      if (quote) {
        const link = quote.querySelector('a[href*="/status/"]');
        if (link) result.quotedTweet = link.href;
      }
    } catch {}

    // 回复上下文
    try {
      const social = article.querySelector('[data-testid="socialContext"]');
      if (social) {
        const link = social.querySelector('a[href*="/status/"]');
        if (link) result.inReplyTo = link.href;
      }
    } catch {}

  } catch {}
  return result;

  function parseMetricNumber(s) {
    if (!s) return 0;
    s = s.replace(/,/g, '');
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s) || 0;
  }
})()
`;
}
