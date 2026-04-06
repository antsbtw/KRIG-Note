import type { BlockDef } from '../types';
import { createPlaceholder } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * videoBlock — 视频（RenderBlock / Tab Container）
 *
 * 功能层次：
 * - 基础播放：embed 检测（YouTube/Vimeo/直接文件）+ Tab 框架
 * - 字幕系统：cue 解析、CC 浮层、YouTube transcript import、翻译
 * - 学习功能：Memory Playback Mode（艾宾浩斯间隔重复）、Vocab Panel
 */

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

interface SubtitleCue { startTime: number; text: string; }
interface MemoryStep { type: 'play' | 'repeat'; segments: number[]; }
interface VocabTimeEntry { word: string; definition: string; time: number; }

// ═══════════════════════════════════════════════════════════
// Embed 平台检测
// ═══════════════════════════════════════════════════════════

type EmbedType = 'youtube' | 'vimeo' | 'direct' | 'embed';

function detectEmbedType(url: string): EmbedType {
  if (/(?:youtube\.com\/(?:watch|embed|shorts)|youtu\.be\/)/i.test(url)) return 'youtube';
  if (/vimeo\.com\//i.test(url)) return 'vimeo';
  if (/\.(mp4|webm|ogg|m3u8|mpd)(\?|$)/i.test(url)) return 'direct';
  if (/^(blob:|media:)/i.test(url)) return 'direct';
  return 'embed';
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m?.[1] ?? null;
}

function toYouTubeEmbedUrl(id: string): string {
  return `https://www.youtube.com/embed/${id}?enablejsapi=1&rel=0`;
}

function toVimeoEmbedUrl(url: string): string {
  const m = url.match(/vimeo\.com\/(\d+)/);
  return m ? `https://player.vimeo.com/video/${m[1]}` : url;
}

// ═══════════════════════════════════════════════════════════
// 字幕解析
// ═══════════════════════════════════════════════════════════

/** 从 transcript 文本解析字幕 cues（[MM:SS] text 或 [HH:MM:SS] text） */
function parseSubtitleCuesFromText(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)/);
    if (m) {
      const seconds = m[3] !== undefined
        ? parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])
        : parseInt(m[1]) * 60 + parseInt(m[2]);
      const content = m[4].trim();
      if (content) cues.push({ startTime: seconds, text: content });
    }
  }
  return cues;
}

function findActiveCue(cues: SubtitleCue[], currentTime: number): SubtitleCue | null {
  if (cues.length === 0) return null;
  let active: SubtitleCue | null = null;
  for (const cue of cues) {
    if (cue.startTime <= currentTime) active = cue;
    else break;
  }
  return active;
}

// ═══════════════════════════════════════════════════════════
// Memory Playback 序列生成
// ═══════════════════════════════════════════════════════════

function* memoryPlaybackSequence(totalSegments: number): Generator<MemoryStep> {
  if (totalSegments <= 0) return;
  yield { type: 'play', segments: [0] };
  for (let i = 1; i < totalSegments; i++) {
    yield { type: 'repeat', segments: [i - 1, i] };
  }
}



// ═══════════════════════════════════════════════════════════
// Vocab Timeline
// ═══════════════════════════════════════════════════════════

function buildVocabTimeline(
  cues: SubtitleCue[],
  vocabWords: Array<{ word: string; definition: string }>,
): VocabTimeEntry[] {
  if (cues.length === 0 || vocabWords.length === 0) return [];
  const entries: VocabTimeEntry[] = [];
  const wordMap = new Map<string, string>();
  for (const v of vocabWords) wordMap.set(v.word.toLowerCase(), v.definition);

  for (const cue of cues) {
    const textLower = cue.text.toLowerCase();
    for (const [word, def] of wordMap) {
      const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(textLower)) {
        entries.push({ word, definition: def, time: cue.startTime });
      }
    }
  }
  entries.sort((a, b) => a.time - b.time);
  return entries;
}

function getVocabWindow(timeline: VocabTimeEntry[], currentTime: number, windowSize = 5) {
  if (timeline.length === 0) return { entries: [] as VocabTimeEntry[], currentIndex: -1 };
  let idx = 0;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].time <= currentTime) idx = i;
    else break;
  }
  const start = Math.max(0, idx - windowSize);
  const end = Math.min(timeline.length, idx + windowSize + 1);
  return { entries: timeline.slice(start, end), currentIndex: idx - start };
}

// ═══════════════════════════════════════════════════════════
// 格式化
// ═══════════════════════════════════════════════════════════

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ═══════════════════════════════════════════════════════════
// Renderer
// ═══════════════════════════════════════════════════════════

/** Video NodeView 工厂（独立管理 toolbar，不继承 RenderBlock 基类） */
function videoNodeView(node: PMNode, view: EditorView, getPos: () => number | undefined) {
  const dom = document.createElement('div');
  dom.classList.add('render-block', 'render-block--videoBlock');

  const content = document.createElement('div');
  content.classList.add('render-block__content', 'video-block');

    const api = (window as any).viewAPI;

    // ── 状态 ──
    let currentTime = 0;
    let subtitleCues: SubtitleCue[] = [];
    let ccEnabled = false;
    let memoryActive = false;
    let memoryGenerator: Generator<MemoryStep> | null = null;
    let memoryCurrentStep: MemoryStep | null = null;
    let memoryStepIndex = 0;
    let timePollingId: number | null = null;
    let vocabTimeline: VocabTimeEntry[] = [];
    let vocabPanelVisible = false;
    let transcriptText = '';  // 存储 transcript 文本

    const segDuration = (node.attrs.segmentDuration as number) || 60;

    const updateAttrs = (attrs: Record<string, unknown>) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      let tr = view.state.tr;
      for (const [key, value] of Object.entries(attrs)) {
        tr = tr.setNodeAttribute(pos, key, value);
      }
      view.dispatch(tr);
    };

    if (node.attrs.src) {
      const src = node.attrs.src as string;
      const embedType = (node.attrs.embedType as string) || detectEmbedType(src);

      // ── Tab 栏 ──
      const tabBar = document.createElement('div');
      tabBar.classList.add('video-block__tab-bar');

      const activeTab = (node.attrs.activeTab as string) || 'play';
      // 静态 Tab: Video / Meta / EN
      const staticTabs = [
        { id: 'play', label: 'Video' },
        { id: 'data', label: 'Meta' },
        { id: 'transcript', label: 'EN' },
      ];
      // 翻译 Tab 动态添加
      const translationTabs: Array<{ id: string; label: string }> = [];
      // 翻译 Tab 内容存储
      const translationTexts = new Map<string, string>();

      function addTabButton(tab: { id: string; label: string }) {
        const btn = document.createElement('button');
        btn.classList.add('video-block__tab-btn');
        if (tab.id === activeTab) btn.classList.add('video-block__tab-btn--active');
        btn.textContent = tab.label;
        btn.dataset.tabId = tab.id;
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation();
          tabBar.querySelectorAll('.video-block__tab-btn').forEach(b => b.classList.remove('video-block__tab-btn--active'));
          btn.classList.add('video-block__tab-btn--active');
          updateAttrs({ activeTab: tab.id });
          showTab(tab.id);
        });
        // 插入到 actionBar 前面
        tabBar.insertBefore(btn, actionBar);
      }

      function switchToTab(tabId: string) {
        tabBar.querySelectorAll('.video-block__tab-btn').forEach(b => b.classList.remove('video-block__tab-btn--active'));
        tabBar.querySelector(`[data-tab-id="${tabId}"]`)?.classList.add('video-block__tab-btn--active');
        showTab(tabId);
      }

      // ── 下载进度条 ──
      const progressBar = document.createElement('div');
      progressBar.classList.add('video-block__progress');
      progressBar.style.display = 'none';
      const progressFill = document.createElement('div');
      progressFill.classList.add('video-block__progress-fill');
      progressBar.appendChild(progressFill);
      const setProgress = (percent: number) => {
        progressFill.style.width = `${Math.min(100, percent)}%`;
      };

      // ── Action 按钮 ── (先创建 actionBar 供 addTabButton 引用)
      const actionBar = document.createElement('div');
      actionBar.classList.add('video-block__action-bar');
      tabBar.appendChild(actionBar);

      // 创建静态 Tab 按钮
      for (const tab of staticTabs) addTabButton(tab);

      // ── 辅助：创建 action 按钮 ──
      function createActionBtn(label: string, title: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.classList.add('video-block__action-btn');
        btn.textContent = label;
        btn.title = title;
        actionBar.appendChild(btn);
        return btn;
      }

      // ── CC 按钮（下拉菜单：语言选择 + OFF） ──
      let ccLang = 'transcript'; // 当前 CC 语言
      const ccBtn = createActionBtn('CC', 'Subtitles');

      const ccDropdown = document.createElement('div');
      ccDropdown.classList.add('video-block__dropdown');
      ccDropdown.style.display = 'none';
      tabBar.appendChild(ccDropdown);

      function rebuildCCDropdown() {
        ccDropdown.innerHTML = '';
        const langs = ['transcript', ...translationTabs.map(t => t.id)];
        for (const lang of langs) {
          const item = document.createElement('button');
          item.classList.add('video-block__dropdown-item');
          item.textContent = lang === 'transcript' ? 'EN' : lang.toUpperCase();
          if (ccEnabled && ccLang === lang) item.classList.add('video-block__dropdown-item--active');
          item.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            ccEnabled = true;
            ccLang = lang;
            ccBtn.textContent = 'CC✓';
            refreshSubtitleCues();
            if (!timePollingId) startTimePolling();
            ccDropdown.style.display = 'none';
          });
          ccDropdown.appendChild(item);
        }
        // OFF 选项
        const offItem = document.createElement('button');
        offItem.classList.add('video-block__dropdown-item');
        offItem.textContent = 'OFF';
        if (!ccEnabled) offItem.classList.add('video-block__dropdown-item--active');
        offItem.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation();
          ccEnabled = false;
          ccBtn.textContent = 'CC';
          subtitleOverlay.style.display = 'none';
          ccDropdown.style.display = 'none';
        });
        ccDropdown.appendChild(offItem);
      }

      ccBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        rebuildCCDropdown();
        ccDropdown.style.display = ccDropdown.style.display === 'none' ? '' : 'none';
      });

      // ── Memory Mode 按钮（⏮ 🧠 ⏭ + 下拉选择分段时长） ──
      const memPrevBtn = createActionBtn('⏮', 'Previous segment');
      memPrevBtn.disabled = true;
      memPrevBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (memoryActive) prevMemoryStep();
      });

      const memBtn = createActionBtn('🧠', 'Memory playback mode');

      const memDropdown = document.createElement('div');
      memDropdown.classList.add('video-block__dropdown');
      memDropdown.style.display = 'none';
      tabBar.appendChild(memDropdown);
      for (const dur of [30, 60, 90, 120]) {
        const item = document.createElement('button');
        item.classList.add('video-block__dropdown-item');
        item.textContent = `${dur}s`;
        item.dataset.dur = String(dur);
        if (dur === segDuration) item.classList.add('video-block__dropdown-item--active');
        item.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation();
          // 更新所有 item 的 active 状态
          memDropdown.querySelectorAll('.video-block__dropdown-item').forEach(el =>
            el.classList.toggle('video-block__dropdown-item--active', (el as HTMLElement).dataset.dur === String(dur))
          );
          updateAttrs({ segmentDuration: dur });
          memDropdown.style.display = 'none';
          if (memoryActive) stopMemoryMode();
          startMemoryMode(dur);
        });
        memDropdown.appendChild(item);
      }

      memBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (memoryActive) {
          stopMemoryMode();
          memBtn.textContent = '🧠';
          memPrevBtn.disabled = true;
          memSkipBtn.disabled = true;
        } else {
          memDropdown.style.display = memDropdown.style.display === 'none' ? '' : 'none';
        }
      });

      const memSkipBtn = createActionBtn('⏭', 'Skip segment');
      memSkipBtn.disabled = true;
      memSkipBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (memoryActive) advanceMemoryStep();
      });

      // ── Translate 按钮 ──
      const translateBtn = createActionBtn('🌐', 'Translate subtitles');
      translateBtn.addEventListener('mousedown', async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!api?.translateText || !transcriptText) return;
        translateBtn.textContent = '⏳';
        translateBtn.disabled = true;
        const targetLang = 'zh-CN';
        try {
          const lines = transcriptText.split('\n').filter(l => l.trim());
          const BATCH_LIMIT = 4500;
          const translated: string[] = [];
          let batch: string[] = [];
          let batchLen = 0;

          for (let i = 0; i <= lines.length; i++) {
            const line = i < lines.length ? lines[i] : null;
            const textOnly = line?.replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, '') || null;
            const shouldFlush = !textOnly || (batchLen + textOnly.length + 1 > BATCH_LIMIT && batch.length > 0);
            if (shouldFlush && batch.length > 0) {
              const result = await api.translateText(batch.join('\n'), targetLang);
              if (result?.text) translated.push(...result.text.split('\n'));
              else translated.push(...batch);
              batch = []; batchLen = 0;
            }
            if (textOnly) { batch.push(textOnly); batchLen += textOnly.length + 1; }
          }

          // 重建翻译文本（时间戳 + 翻译）
          const timestamps = lines.map(l => {
            const m = l.match(/^(\[\d{1,2}:\d{2}(?::\d{2})?\])/);
            return m?.[1] || '';
          });
          const translatedLines = translated.map((t, i) => {
            const ts = timestamps[i] || '';
            return ts ? `${ts} ${t}` : t;
          });
          const translatedText = translatedLines.join('\n');

          // 创建翻译 Tab
          addTranslationTab(targetLang, translatedText);
        } catch { /* ignore */ }
        translateBtn.textContent = '🌐';
        translateBtn.disabled = false;
      });

      // ── Import Transcript 按钮 ──
      const importBtn = createActionBtn('📝', 'Download subtitle');
      importBtn.addEventListener('mousedown', async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!api?.fetchYouTubeTranscript) return;
        importBtn.textContent = '⏳';
        importBtn.disabled = true;
        try {
          const result = await api.fetchYouTubeTranscript(src);
          if (result?.success && result.transcript) {
            const segments: Array<{ time: number; text: string }> = JSON.parse(result.transcript);
            const lines = segments.map(seg => {
              const mm = String(Math.floor(seg.time / 60)).padStart(2, '0');
              const ss = String(Math.floor(seg.time % 60)).padStart(2, '0');
              return `[${mm}:${ss}] ${seg.text}`;
            });
            transcriptText = lines.join('\n');
            transcriptArea.value = transcriptText;
            subtitleCues = parseSubtitleCuesFromText(transcriptText);
            switchToTab('transcript');
          }
        } catch { /* ignore */ }
        importBtn.textContent = '📝';
        importBtn.disabled = false;
      });

      // ── Download 按钮（yt-dlp，下载视频 + 字幕） ──
      let ytdlpAvailable = false;
      let downloadState: 'idle' | 'downloading' | 'done' = 'idle';
      let downloadedPath: string | null = null;

      const dlBtn = createActionBtn('⬇️', 'Click to install yt-dlp');
      dlBtn.disabled = true;

      api?.ytdlpCheckStatus?.().then((s: { installed: boolean }) => {
        ytdlpAvailable = s.installed;
        dlBtn.disabled = false;
        dlBtn.title = ytdlpAvailable ? 'Download video' : 'Click to install yt-dlp';
      }).catch(() => {});

      dlBtn.addEventListener('mousedown', async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!ytdlpAvailable) {
          dlBtn.textContent = '⏳'; dlBtn.title = 'Installing yt-dlp...'; dlBtn.disabled = true;
          try {
            const result = await api?.ytdlpInstall?.();
            if (result?.success) {
              ytdlpAvailable = true;
              dlBtn.textContent = '⬇️'; dlBtn.title = 'Download video'; dlBtn.disabled = false;
            } else {
              dlBtn.textContent = '❌';
              setTimeout(() => { dlBtn.textContent = '⬇️'; dlBtn.disabled = false; }, 2000);
            }
          } catch {
            dlBtn.textContent = '❌';
            setTimeout(() => { dlBtn.textContent = '⬇️'; dlBtn.disabled = false; }, 2000);
          }
          return;
        }
        if (downloadState === 'done' && downloadedPath) {
          api?.showItemInFolder?.(downloadedPath);
          return;
        }
        if (downloadState === 'downloading') return;

        downloadState = 'downloading';
        dlBtn.textContent = '⏳'; dlBtn.disabled = true;
        progressBar.style.display = 'flex';
        setProgress(0);
        try {
          const result = await api?.ytdlpDownload?.(src);
          if (result?.status === 'complete') {
            downloadState = 'done';
            downloadedPath = result?.filename || null;
            dlBtn.textContent = '📁'; dlBtn.title = 'Open in Finder'; dlBtn.disabled = false;
            // 填入字幕
            if (result.subtitleText && !transcriptText) {
              transcriptText = result.subtitleText;
              transcriptArea.value = transcriptText;
              subtitleCues = parseSubtitleCuesFromText(transcriptText);
            }
            // 保存翻译字幕为 .srt 文件
            if (downloadedPath && translationTexts.size > 0) {
              for (const [lang, text] of translationTexts) {
                api?.ytdlpSaveSubtitle?.(downloadedPath, lang, text);
              }
            }
          } else {
            downloadState = 'idle';
            dlBtn.textContent = '❌';
            setTimeout(() => { dlBtn.textContent = '⬇️'; dlBtn.disabled = false; }, 2000);
          }
        } catch {
          downloadState = 'idle';
          dlBtn.textContent = '❌';
          setTimeout(() => { dlBtn.textContent = '⬇️'; dlBtn.disabled = false; }, 2000);
        }
        progressBar.style.display = 'none';
      });

      api?.onYtdlpProgress?.((progress: { url: string; status: string; percent: number }) => {
        if (progress.url === src || progress.url === '') setProgress(progress.percent);
      });

      // ── Vocab Panel 按钮 ──
      const vocabBtn = createActionBtn('📖', 'Vocab scroll panel');
      vocabBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        vocabPanelVisible = !vocabPanelVisible;
        vocabBtn.textContent = vocabPanelVisible ? '📖✓' : '📖';
        vocabPanel.style.display = vocabPanelVisible ? 'block' : 'none';
        if (vocabPanelVisible) refreshVocabTimeline();
      });

      // ── Fullscreen 按钮 ──
      const fsBtn = createActionBtn('⛶', 'Fullscreen');
      fsBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        playPanel.requestFullscreen?.().catch(() => {});
      });

      // ── Play Tab ──
      const playPanel = document.createElement('div');
      playPanel.classList.add('video-block__play-panel');

      let videoEl: HTMLVideoElement | null = null;

      // ── YouTube IFrame API 状态 ──
      let ytIframe: HTMLIFrameElement | null = null;
      let ytCurrentTime = 0;
      let ytDuration = 0;
      let ytMessageListener: ((e: MessageEvent) => void) | null = null;

      function setupYouTubeAPI(iframe: HTMLIFrameElement) {
        ytIframe = iframe;
        ytMessageListener = (event: MessageEvent) => {
          if (!iframe.contentWindow || event.source !== iframe.contentWindow) return;
          try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (data.event === 'infoDelivery' && data.info?.currentTime != null) {
              ytCurrentTime = data.info.currentTime;
            }
            if (data.info?.duration != null && data.info.duration > 0 && ytDuration === 0) {
              ytDuration = data.info.duration;
            }
          } catch { /* ignore */ }
        };
        window.addEventListener('message', ytMessageListener);
        // iframe 加载后发送 listening 激活 YouTube 推送 infoDelivery
        iframe.addEventListener('load', () => {
          iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), '*');
        });
      }

      function cleanupYouTubeAPI() {
        if (ytMessageListener) { window.removeEventListener('message', ytMessageListener); ytMessageListener = null; }
        ytIframe = null; ytCurrentTime = 0; ytDuration = 0;
      }

      function getCurrentPlaybackTime(): number {
        if (videoEl) return videoEl.currentTime;
        if (ytIframe) return ytCurrentTime;
        return 0;
      }

      function ytSeekTo(seconds: number) {
        ytIframe?.contentWindow?.postMessage(JSON.stringify({
          event: 'command', func: 'seekTo', args: [seconds, true],
        }), '*');
      }

      function ytPlay() {
        ytIframe?.contentWindow?.postMessage(JSON.stringify({
          event: 'command', func: 'playVideo', args: [],
        }), '*');
      }

      if (embedType === 'youtube') {
        const videoId = extractYouTubeId(src);
        if (videoId) {
          const iframe = document.createElement('iframe');
          iframe.src = toYouTubeEmbedUrl(videoId) + '&enablejsapi=1';
          iframe.setAttribute('allowfullscreen', '');
          iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
          iframe.style.cssText = 'width:100%; aspect-ratio:16/9; border:none; border-radius:4px;';
          playPanel.appendChild(iframe);
          setupYouTubeAPI(iframe);
          if (!node.attrs.embedType) updateAttrs({ embedType: 'youtube' });
        }
      } else if (embedType === 'vimeo') {
        const iframe = document.createElement('iframe');
        iframe.src = toVimeoEmbedUrl(src);
        iframe.setAttribute('allowfullscreen', '');
        iframe.style.cssText = 'width:100%; aspect-ratio:16/9; border:none; border-radius:4px;';
        playPanel.appendChild(iframe);
        if (!node.attrs.embedType) updateAttrs({ embedType: 'vimeo' });
      } else {
        videoEl = document.createElement('video');
        videoEl.src = src;
        videoEl.controls = true;
        videoEl.style.cssText = 'width:100%; border-radius:4px;';
        playPanel.appendChild(videoEl);
        if (!node.attrs.embedType) updateAttrs({ embedType: 'direct' });
      }

      // ── Subtitle Overlay ──
      const subtitleOverlay = document.createElement('div');
      subtitleOverlay.classList.add('video-block__subtitle-overlay');
      subtitleOverlay.style.display = 'none';
      const subtitleTextEl = document.createElement('span');
      subtitleTextEl.classList.add('video-block__subtitle-text');
      subtitleOverlay.appendChild(subtitleTextEl);
      playPanel.appendChild(subtitleOverlay);

      // ── Vocab Panel ──
      const vocabPanel = document.createElement('div');
      vocabPanel.classList.add('video-block__vocab-panel');
      vocabPanel.style.display = 'none';
      playPanel.appendChild(vocabPanel);

      // Memory 进度显示在 🧠 按钮文字上（如 🧠 3/146）

      // ── Data Tab ──
      const dataPanel = document.createElement('div');
      dataPanel.classList.add('video-block__data-panel');
      dataPanel.style.display = 'none';
      buildDataPanel(dataPanel, node);

      // ── Transcript Tab ──
      const transcriptPanel = document.createElement('div');
      transcriptPanel.classList.add('video-block__transcript-panel');
      transcriptPanel.style.display = 'none';

      const transcriptArea = document.createElement('textarea');
      transcriptArea.classList.add('video-block__transcript-area');
      transcriptArea.placeholder = 'Click 📝 to import YouTube transcript, or paste [MM:SS] text format here...';
      transcriptArea.addEventListener('input', () => {
        transcriptText = transcriptArea.value;
        subtitleCues = parseSubtitleCuesFromText(transcriptText);
      });
      transcriptPanel.appendChild(transcriptArea);

      // Translation area (below transcript)
      const translationPanel = document.createElement('div');
      translationPanel.classList.add('video-block__translation-panel');
      translationPanel.style.display = 'none';
      const translationLabel = document.createElement('div');
      translationLabel.classList.add('video-block__translation-label');
      translationLabel.textContent = 'Translation (ZH-CN)';
      translationPanel.appendChild(translationLabel);
      const translationArea = document.createElement('textarea');
      translationArea.classList.add('video-block__transcript-area');
      translationArea.placeholder = 'Translation will appear here...';
      translationPanel.appendChild(translationArea);
      transcriptPanel.appendChild(translationPanel);

      // ── 翻译 Tab 管理 ──
      const translationPanels = new Map<string, HTMLElement>();

      function addTranslationTab(langCode: string, text: string) {
        translationTexts.set(langCode, text);

        // 如果 Tab 已存在，更新内容
        const existingPanel = translationPanels.get(langCode);
        if (existingPanel) {
          const area = existingPanel.querySelector('textarea');
          if (area) (area as HTMLTextAreaElement).value = text;
          switchToTab(langCode);
          return;
        }

        // 创建新 Tab
        const tab = { id: langCode, label: langCode.toUpperCase() };
        translationTabs.push(tab);
        addTabButton(tab);

        // 创建面板
        const panel = document.createElement('div');
        panel.classList.add('video-block__transcript-panel');
        panel.style.display = 'none';
        const header = document.createElement('div');
        header.classList.add('video-block__translation-label');
        header.textContent = `TRANSLATION (${langCode.toUpperCase()})`;
        panel.appendChild(header);
        const area = document.createElement('textarea');
        area.classList.add('video-block__transcript-area');
        area.value = text;
        panel.appendChild(area);
        tabContent.appendChild(panel);
        translationPanels.set(langCode, panel);

        switchToTab(langCode);
      }

      // ── Tab 切换 ──
      function showTab(tabId: string) {
        playPanel.style.display = tabId === 'play' ? 'block' : 'none';
        dataPanel.style.display = tabId === 'data' ? 'block' : 'none';
        transcriptPanel.style.display = tabId === 'transcript' ? 'flex' : 'none';
        for (const [lang, panel] of translationPanels) {
          panel.style.display = tabId === lang ? 'flex' : 'none';
        }
      }
      showTab(activeTab);

      // ── Time Polling ──
      function startTimePolling() {
        if (timePollingId) return;
        timePollingId = window.setInterval(() => {
          currentTime = getCurrentPlaybackTime();
          // Update subtitle
          if (ccEnabled) {
            const cue = findActiveCue(subtitleCues, currentTime);
            if (cue) {
              subtitleTextEl.textContent = cue.text;
              subtitleOverlay.style.display = '';
            } else {
              subtitleOverlay.style.display = 'none';
            }
          }
          // Update vocab panel
          if (vocabPanelVisible && vocabTimeline.length > 0) {
            const win = getVocabWindow(vocabTimeline, currentTime);
            vocabPanel.innerHTML = win.entries.map((e, i) =>
              `<div class="video-block__vocab-item${i === win.currentIndex ? ' video-block__vocab-item--current' : ''}">`
              + `<div class="video-block__vocab-word">${e.word}</div>`
              + `<div class="video-block__vocab-def">${e.definition}</div></div>`
            ).join('');
          }
          // Memory mode boundary check
          if (memoryActive && memoryCurrentStep) {
            const lastSeg = memoryCurrentStep.segments[memoryCurrentStep.segments.length - 1];
            const boundary = (lastSeg + 1) * segDuration;
            if (currentTime >= boundary - 0.3) advanceMemoryStep();
          }
        }, 300);
      }

      function stopTimePolling() {
        if (timePollingId) { clearInterval(timePollingId); timePollingId = null; }
      }

      function refreshSubtitleCues() {
        if (ccLang === 'transcript') {
          subtitleCues = parseSubtitleCuesFromText(transcriptText);
        } else {
          const translatedText = translationTexts.get(ccLang) || '';
          subtitleCues = parseSubtitleCuesFromText(translatedText);
        }
      }

      function refreshVocabTimeline() {
        // 从学习模块获取词汇表
        if (api?.listVocabWords) {
          api.listVocabWords().then((words: Array<{ word: string; definition: string }>) => {
            vocabTimeline = buildVocabTimeline(subtitleCues, words);
          }).catch(() => {});
        }
      }

      // ── Memory Mode ──
      function startMemoryMode(overrideDuration?: number) {
        const duration = videoEl ? videoEl.duration : ytDuration;
        if (!duration || duration <= 0) return;
        const useDuration = overrideDuration || segDuration;
        const totalSegments = Math.ceil(duration / useDuration);
        memoryGenerator = memoryPlaybackSequence(totalSegments);
        memoryActive = true;

        // 恢复上次步骤
        const lastStep = (node.attrs.memoryLastStep as number) || 0;
        for (let i = 0; i < lastStep; i++) {
          const r = memoryGenerator.next();
          if (r.done) break;
          memoryStepIndex = i;
        }
        advanceMemoryStep();
        updateMemoryBtnLabel();
        memBtn.textContent = '🧠';
        memPrevBtn.disabled = false;
        memSkipBtn.disabled = false;
        startTimePolling();
      }

      function stopMemoryMode() {
        memoryActive = false;
        memoryGenerator = null;
        memoryCurrentStep = null;
        memBtn.textContent = '🧠';
        memPrevBtn.disabled = true;
        memSkipBtn.disabled = true;
        updateAttrs({ memoryLastStep: memoryStepIndex, memoryMode: false });
        if (!ccEnabled && !vocabPanelVisible) stopTimePolling();
      }

      function prevMemoryStep() {
        if (!memoryActive || memoryStepIndex <= 1) return;
        // 重建 generator 到前一步
        const useDuration = (node.attrs.segmentDuration as number) || segDuration;
        const duration = videoEl ? videoEl.duration : ytDuration;
        if (!duration) return;
        const totalSegments = Math.ceil(duration / useDuration);
        memoryGenerator = memoryPlaybackSequence(totalSegments);
        memoryStepIndex = 0;
        const targetStep = Math.max(1, memoryStepIndex);
        for (let i = 0; i < targetStep - 1; i++) {
          const r = memoryGenerator.next();
          if (r.done) break;
          memoryStepIndex = i + 1;
        }
        advanceMemoryStep();
      }

      function advanceMemoryStep() {
        if (!memoryGenerator) return;
        const result = memoryGenerator.next();
        if (result.done) { stopMemoryMode(); return; }
        memoryCurrentStep = result.value;
        memoryStepIndex++;
        // Seek to start of first segment
        const startSeg = memoryCurrentStep.segments[0];
        const seekTime = startSeg * segDuration;
        if (videoEl) { videoEl.currentTime = seekTime; videoEl.play(); }
        else if (ytIframe) { ytSeekTo(seekTime); ytPlay(); }
        updateMemoryBtnLabel();
      }

      function updateMemoryBtnLabel() {
        const dur = videoEl ? videoEl.duration : ytDuration;
        if (!dur) return;
        const total = Math.ceil(dur / segDuration);
        memBtn.textContent = `🧠 ${memoryStepIndex}/${total}`;
      }

      // Start polling if CC or video is playing
      if (videoEl) {
        videoEl.addEventListener('play', () => { if (ccEnabled || memoryActive || vocabPanelVisible) startTimePolling(); });
        videoEl.addEventListener('pause', () => { if (!memoryActive) stopTimePolling(); });
      }

      // ── 组装 ──
      const tabContent = document.createElement('div');
      tabContent.classList.add('video-block__tab-content');
      tabContent.appendChild(playPanel);
      tabContent.appendChild(progressBar);
      tabContent.appendChild(dataPanel);
      tabContent.appendChild(transcriptPanel);

      content.appendChild(tabBar);
      content.appendChild(tabContent);

      // 存储引用用于 destroy
      (content as any)._videoEl = videoEl;
      (content as any)._stopTimePolling = stopTimePolling;
      (content as any)._stopMemory = () => { if (memoryActive) stopMemoryMode(); };
      (content as any)._cleanupYouTube = cleanupYouTubeAPI;
    } else {
      // ── Placeholder ──
      const placeholder = createPlaceholder({
        icon: '🎬',
        embedLabel: 'Embed link',
        embedPlaceholder: 'Paste video URL (YouTube, Vimeo, .mp4)...',
        onEmbed: (url) => updateAttrs({ src: url, embedType: detectEmbedType(url) }),
      });
      content.appendChild(placeholder);
    }

    // ── Caption ──
    const captionDOM = document.createElement('div');
    captionDOM.classList.add('video-block__caption');
    content.appendChild(captionDOM);

    dom.appendChild(content);

    // ── NodeView 接口 ──
    return {
      dom,
      contentDOM: captionDOM,

      selectNode() { dom.classList.add('render-block--selected'); },
      deselectNode() { dom.classList.remove('render-block--selected'); },

      stopEvent(event: Event) {
        if (event.type === 'contextmenu') return false;
        if (captionDOM.contains(event.target as Node)) return false;
        if (dom.contains(event.target as Node)) return true;
        return false;
      },

      update(updatedNode: PMNode) {
        if (updatedNode.type.name !== 'videoBlock') return false;
        node = updatedNode;
        // 状态切换（placeholder ↔ 播放器）→ 重建
        const hasPlayer = content.querySelector('.video-block__tab-bar') !== null;
        const hasSrc = !!updatedNode.attrs.src;
        if (hasPlayer !== hasSrc) return false;
        return true;
      },

      ignoreMutation(mutation: MutationRecord) {
        if (captionDOM.contains(mutation.target)) return false;
        return true;
      },

      destroy() {
        (content as any)._stopTimePolling?.();
        (content as any)._stopMemory?.();
        const vid = (content as any)._videoEl as HTMLVideoElement | undefined;
        if (vid) { vid.pause(); vid.src = ''; }
        (content as any)._cleanupYouTube?.();
      },
    };
  }

function buildDataPanel(panel: HTMLElement, node: PMNode): void {
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse((node.attrs.metadata as string) || '{}'); } catch { /* ignore */ }

  if (Object.keys(metadata).length > 0) {
    const rows: string[] = [];
    if (metadata.title) rows.push(`<div class="video-block__meta-row"><strong>${metadata.title}</strong></div>`);
    const infoParts: string[] = [];
    if (metadata.domain) infoParts.push(metadata.domain as string);
    if (metadata.duration) infoParts.push(formatDuration(metadata.duration as number));
    if (metadata.publishedAt) infoParts.push(new Date(metadata.publishedAt as string).toLocaleDateString());
    if (infoParts.length) rows.push(`<div class="video-block__meta-row">${infoParts.join(' · ')}</div>`);
    if (metadata.author) {
      const authorLink = metadata.authorUrl ? `<a href="${metadata.authorUrl}" target="_blank" style="color:#8ab4f8">${metadata.author}</a>` : metadata.author;
      rows.push(`<div class="video-block__meta-row">Author: ${authorLink}</div>`);
    }
    const stats: string[] = [];
    if (metadata.viewCount) stats.push(`👁 ${formatCount(metadata.viewCount as number)}`);
    if (metadata.likeCount) stats.push(`❤ ${formatCount(metadata.likeCount as number)}`);
    if (metadata.commentCount) stats.push(`💬 ${formatCount(metadata.commentCount as number)}`);
    if (stats.length) rows.push(`<div class="video-block__meta-row">${stats.join('  ')}</div>`);
    if (metadata.tags) rows.push(`<div class="video-block__meta-row">Tags: ${(metadata.tags as string[]).join(', ')}</div>`);
    if (metadata.resolution) rows.push(`<div class="video-block__meta-row">${metadata.resolution} · ${metadata.format || ''}</div>`);
    if (metadata.description) rows.push(`<div class="video-block__meta-row" style="margin-top:8px;color:#9aa0a6">${metadata.description}</div>`);
    panel.innerHTML = rows.join('');
  } else {
    panel.innerHTML = '<div class="video-block__meta-empty">No metadata available. Use yt-dlp to fetch metadata.</div>';
  }
}

export const videoBlockBlock: BlockDef = {
  name: 'videoBlock',
  group: 'block',
  nodeSpec: {
    content: 'textBlock',
    group: 'block',
    draggable: true,
    selectable: true,
    attrs: {
      atomId:          { default: null },
      sourcePages:     { default: null },
      thoughtId:       { default: null },
      src:             { default: null },
      title:           { default: '' },
      poster:          { default: null },
      embedType:       { default: '' },
      metadata:        { default: '{}' },
      activeTab:       { default: 'play' },
      memoryMode:      { default: false },
      segmentDuration: { default: 60 },
      memoryLastStep:  { default: null },
    },
    parseDOM: [{ tag: 'div.video-block' }],
    toDOM() { return ['div', { class: 'video-block' }, 0]; },
  },
  nodeView: videoNodeView,
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'Video', icon: '🎬', group: 'media', keywords: ['video', 'youtube', 'vimeo', 'mp4', '视频'], order: 2 },
};
