/**
 * DictionaryPanel — 字典查词 / 翻译浮动面板
 *
 * 纯 DOM 实现，运行在 note renderer 进程中。
 * 两个 tab：查词 | 生词本
 *
 * 两种显示模式：
 * - 查词模式：词典释义 + 中文翻译补充
 * - 翻译模式：句子/段落翻译
 *
 * 作为外部面板注册到 help-panel 互斥框架。
 */

import type { LookupResult, VocabEntry } from './types';
import {
  registerExternalPanel,
  notifyExternalShow,
  notifyExternalHide,
} from '../help-panel/help-panel-core';

declare const viewAPI: {
  lookupWord?: (word: string) => Promise<LookupResult | null>;
  translateText?: (text: string, targetLang?: string) => Promise<{ text: string } | null>;
  playTTS?: (text: string, lang: string) => Promise<ArrayBuffer | null>;
  addVocabWord?: (word: string, definition: string, context?: string, phonetic?: string) => Promise<VocabEntry>;
  removeVocabWord?: (id: string) => Promise<void>;
  listVocabWords?: () => Promise<VocabEntry[]>;
};

let panelEl: HTMLDivElement | null = null;
let currentTab: 'lookup' | 'vocab' = 'lookup';
let currentLookup: LookupResult | null = null;
let currentTranslation: string | null = null;
let currentMode: 'lookup' | 'translate' = 'lookup';
let currentText = '';
let currentContext: string | undefined;
let vocabEntries: VocabEntry[] = [];
let filterText = '';
let showTimestamp = 0;

// ─── Public API ──────────────────────────────────────────────

/** 查词模式：词典释义 + 中文翻译补充 */
export function showDictionaryPanel(word: string, sentence?: string): void {
  currentContext = sentence;
  currentTab = 'lookup';
  currentMode = 'lookup';
  currentText = word;
  currentLookup = null;
  currentTranslation = null;
  ensurePanel();
  switchTab('lookup');
  setLoading(word);
  show();

  // 并行请求：词典 + 翻译
  const lookupPromise = viewAPI.lookupWord?.(word) || Promise.resolve(null);
  const translatePromise = viewAPI.translateText?.(word) || Promise.resolve(null);

  Promise.all([lookupPromise, translatePromise]).then(([dictResult, transResult]) => {
    currentLookup = dictResult as LookupResult | null;
    currentTranslation = (transResult as { text: string } | null)?.text || null;
    renderLookupTab();
  });
}

/** 翻译模式：句子/段落翻译 */
export function showTranslationPanel(text: string): void {
  currentContext = undefined;
  currentTab = 'lookup';
  currentMode = 'translate';
  currentText = text;
  currentLookup = null;
  currentTranslation = null;
  ensurePanel();
  switchTab('lookup');
  setLoading(text.length > 60 ? text.slice(0, 60) + '...' : text);
  show();

  viewAPI.translateText?.(text).then(result => {
    currentTranslation = (result as { text: string } | null)?.text || null;
    renderLookupTab();
  });
}

export function hideDictionaryPanel(): void {
  if (panelEl) {
    panelEl.style.display = 'none';
  }
  notifyExternalHide('dictionary');
}

export function updateVocabList(entries: VocabEntry[]): void {
  vocabEntries = entries;
  if (panelEl && currentTab === 'vocab') {
    renderVocabTab();
  }
}

export function isDictionaryPanelVisible(): boolean {
  return panelEl?.style.display === 'flex';
}

// ─── DOM Construction ────────────────────────────────────────

function ensurePanel(): void {
  if (panelEl) return;

  panelEl = document.createElement('div');
  panelEl.className = 'dictionary-panel';
  panelEl.style.display = 'none';

  panelEl.innerHTML = `
    <div class="dictionary-panel__header">
      <span class="dictionary-panel__title">Dictionary</span>
      <button class="dictionary-panel__close-btn">\u00d7</button>
      <div class="dictionary-panel__tabs">
        <button class="dictionary-panel__tab dictionary-panel__tab--active" data-tab="lookup">查词</button>
        <button class="dictionary-panel__tab" data-tab="vocab">生词本</button>
      </div>
    </div>
    <div class="dictionary-panel__body">
      <div class="dictionary-panel__lookup"></div>
      <div class="dictionary-panel__vocab-list" style="display:none">
        <input class="dictionary-panel__search" type="text" placeholder="搜索生词..." />
        <div class="dictionary-panel__entries"></div>
      </div>
    </div>
  `;

  panelEl.querySelector('.dictionary-panel__close-btn')!
    .addEventListener('click', hideDictionaryPanel);

  panelEl.querySelectorAll('.dictionary-panel__tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab as 'lookup' | 'vocab';
      switchTab(tab);
    });
  });

  const searchInput = panelEl.querySelector('.dictionary-panel__search') as HTMLInputElement;
  searchInput.addEventListener('input', () => {
    filterText = searchInput.value.toLowerCase();
    renderVocabTab();
  });

  // 防止输入框以外的点击导致编辑器失焦
  panelEl.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
  });

  // 点击面板外部自动隐藏
  // 使用 showTimestamp 防止触发 show 的同一个 mousedown 立刻关闭面板
  document.addEventListener('mousedown', (e) => {
    if (!panelEl || panelEl.style.display === 'none') return;
    if (panelEl.contains(e.target as Node)) return;
    if (Date.now() - showTimestamp < 100) return;
    hideDictionaryPanel();
  });

  // 注册到 Help Panel 互斥框架
  registerExternalPanel('dictionary', () => {
    if (panelEl) panelEl.style.display = 'none';
  });

  document.body.appendChild(panelEl);
}

function show(): void {
  if (panelEl) panelEl.style.display = 'flex';
  showTimestamp = Date.now();
  notifyExternalShow('dictionary');
}

function switchTab(tab: 'lookup' | 'vocab'): void {
  currentTab = tab;
  if (!panelEl) return;

  panelEl.querySelectorAll('.dictionary-panel__tab').forEach(btn => {
    btn.classList.toggle('dictionary-panel__tab--active',
      (btn as HTMLElement).dataset.tab === tab);
  });

  const lookupSection = panelEl.querySelector('.dictionary-panel__lookup') as HTMLElement;
  const vocabSection = panelEl.querySelector('.dictionary-panel__vocab-list') as HTMLElement;

  lookupSection.style.display = tab === 'lookup' ? 'block' : 'none';
  vocabSection.style.display = tab === 'vocab' ? 'block' : 'none';

  if (tab === 'vocab') {
    viewAPI.listVocabWords?.().then(entries => {
      vocabEntries = (entries as VocabEntry[]) || [];
      renderVocabTab();
    });
  }
}

// ─── Rendering ───────────────────────────────────────────────

function setLoading(text: string): void {
  const lookupEl = panelEl?.querySelector('.dictionary-panel__lookup');
  if (!lookupEl) return;
  lookupEl.innerHTML = `
    <div class="dictionary-panel__word">${escapeHtml(text)}</div>
    <div class="dictionary-panel__definition" style="color:#9aa0a6;font-style:italic">
      ${currentMode === 'translate' ? '翻译中...' : '查询中...'}
    </div>
  `;
}

function renderLookupTab(): void {
  if (currentMode === 'translate') {
    renderTranslateMode();
  } else {
    renderLookupMode();
  }
}

/** 查词模式：词典释义 + 中文翻译补充 + 添加生词本按钮 */
function renderLookupMode(): void {
  const lookupEl = panelEl?.querySelector('.dictionary-panel__lookup');
  if (!lookupEl) return;

  if (!currentLookup && !currentTranslation) {
    lookupEl.innerHTML = `
      <div class="dictionary-panel__word">${escapeHtml(currentText)}</div>
      <div class="dictionary-panel__definition" style="color:#9aa0a6">未找到释义</div>
    `;
    return;
  }

  const isInVocab = vocabEntries.some(e => e.word === currentText.toLowerCase());
  const word = currentLookup?.word || currentText;

  let html = `<div class="dictionary-panel__word">${escapeHtml(word)} ${ttsButton(word, 'en')}</div>`;

  if (currentLookup?.phonetic) {
    html += `<div class="dictionary-panel__phonetic">${escapeHtml(currentLookup.phonetic)}</div>`;
  }

  if (currentLookup) {
    html += `<div class="dictionary-panel__definition">${escapeHtml(currentLookup.definition)}</div>`;
    html += `<div class="dictionary-panel__source">来源：${escapeHtml(currentLookup.source)}</div>`;
  }

  if (currentTranslation) {
    html += `
      <div class="dictionary-panel__translate-section">
        <div class="dictionary-panel__section-label">中文翻译</div>
        <div class="dictionary-panel__translate-text">${escapeHtml(currentTranslation)} ${ttsButton(currentTranslation, 'zh-CN')}</div>
      </div>
    `;
  }

  html += `
    <div class="dictionary-panel__actions">
      <button class="dictionary-panel__add-btn ${isInVocab ? 'dictionary-panel__add-btn--added' : ''}">
        ${isInVocab ? '✓ 已在生词本' : '+ 添加到生词本'}
      </button>
    </div>
  `;

  lookupEl.innerHTML = html;
  bindTTSButtons(lookupEl);

  if (!isInVocab) {
    lookupEl.querySelector('.dictionary-panel__add-btn')!
      .addEventListener('click', () => {
        const definition = currentLookup?.definition || currentTranslation || '';
        viewAPI.addVocabWord?.(
          currentText,
          definition,
          currentContext,
          currentLookup?.phonetic,
        ).then(() => {
          viewAPI.listVocabWords?.().then(entries => {
            vocabEntries = (entries as VocabEntry[]) || [];
            renderLookupTab();
          });
        });
      });
  }
}

/** 翻译模式：原文 + 翻译结果 */
function renderTranslateMode(): void {
  const lookupEl = panelEl?.querySelector('.dictionary-panel__lookup');
  if (!lookupEl) return;

  if (!currentTranslation) {
    lookupEl.innerHTML = `
      <div class="dictionary-panel__original">${escapeHtml(currentText)}</div>
      <div class="dictionary-panel__definition" style="color:#9aa0a6">翻译失败</div>
    `;
    return;
  }

  const isInVocab = vocabEntries.some(e => e.word === currentText.toLowerCase().trim());

  lookupEl.innerHTML = `
    <div class="dictionary-panel__section-label">原文 ${ttsButton(currentText, 'en')}</div>
    <div class="dictionary-panel__original">${escapeHtml(currentText)}</div>
    <div class="dictionary-panel__section-label" style="margin-top:12px">翻译 ${ttsButton(currentTranslation, 'zh-CN')}</div>
    <div class="dictionary-panel__translate-text">${escapeHtml(currentTranslation)}</div>
    <div class="dictionary-panel__source">来源：Google Translate</div>
    <div class="dictionary-panel__actions">
      <button class="dictionary-panel__add-btn ${isInVocab ? 'dictionary-panel__add-btn--added' : ''}">
        ${isInVocab ? '✓ 已收藏' : '+ 收藏到生词本'}
      </button>
    </div>
  `;
  bindTTSButtons(lookupEl);

  if (!isInVocab) {
    lookupEl.querySelector('.dictionary-panel__add-btn')!
      .addEventListener('click', () => {
        viewAPI.addVocabWord?.(
          currentText,
          currentTranslation || '',
          undefined,
          undefined,
        ).then(() => {
          viewAPI.listVocabWords?.().then(entries => {
            vocabEntries = (entries as VocabEntry[]) || [];
            renderLookupTab();
          });
        });
      });
  }
}

function renderVocabTab(): void {
  const entriesEl = panelEl?.querySelector('.dictionary-panel__entries');
  if (!entriesEl) return;

  const filtered = filterText
    ? vocabEntries.filter(e =>
        e.word.includes(filterText) || e.definition.toLowerCase().includes(filterText))
    : vocabEntries;

  if (filtered.length === 0) {
    entriesEl.innerHTML = `<div class="dictionary-panel__empty">${
      filterText ? '未找到匹配的生词' : '生词本为空'
    }</div>`;
    return;
  }

  entriesEl.innerHTML = filtered.map(entry => {
    const isPhrase = entry.word.includes(' ');
    const displayWord = entry.word.length > 50 ? entry.word.slice(0, 50) + '...' : entry.word;
    const defLimit = isPhrase ? 60 : 100;
    const displayDef = entry.definition.length > defLimit ? entry.definition.slice(0, defLimit) + '...' : entry.definition;
    return `
      <div class="dictionary-panel__entry ${isPhrase ? 'dictionary-panel__entry--phrase' : ''}" data-id="${entry.id}">
        <div class="dictionary-panel__entry-word">${escapeHtml(displayWord)}</div>
        <div class="dictionary-panel__entry-def">${escapeHtml(displayDef)}</div>
        <button class="dictionary-panel__entry-del" title="删除">\u00d7</button>
      </div>
    `;
  }).join('');

  entriesEl.querySelectorAll('.dictionary-panel__entry-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const entryEl = (btn as HTMLElement).closest('.dictionary-panel__entry') as HTMLElement;
      const id = entryEl.dataset.id!;
      viewAPI.removeVocabWord?.(id).then(() => {
        viewAPI.listVocabWords?.().then(entries => {
          vocabEntries = (entries as VocabEntry[]) || [];
          renderVocabTab();
        });
      });
    });
  });

  entriesEl.querySelectorAll('.dictionary-panel__entry').forEach(el => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.id!;
      const entry = vocabEntries.find(e => e.id === id);
      if (!entry) return;
      switchTab('lookup');
      if (entry.word.includes(' ')) {
        showTranslationPanel(entry.word);
      } else {
        showDictionaryPanel(entry.word);
      }
    });
  });
}

// ─── TTS ─────────────────────────────────────────────────────

let ttsAudio: HTMLAudioElement | null = null;
let ttsObjectUrl: string | null = null;

function playTTS(text: string, lang = 'en'): void {
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio = null;
  }
  if (ttsObjectUrl) {
    URL.revokeObjectURL(ttsObjectUrl);
    ttsObjectUrl = null;
  }

  viewAPI.playTTS?.(text, lang).then(buf => {
    if (!buf) return;
    const blob = new Blob([buf], { type: 'audio/mpeg' });
    ttsObjectUrl = URL.createObjectURL(blob);
    ttsAudio = new Audio(ttsObjectUrl);
    ttsAudio.play().catch(() => {});
  });
}

function bindTTSButtons(container: Element): void {
  container.querySelectorAll('.dictionary-panel__tts-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = btn as HTMLElement;
      playTTS(el.dataset.ttsText || '', el.dataset.ttsLang || 'en');
    });
  });
}

function ttsButton(text: string, lang = 'en'): string {
  return `<button class="dictionary-panel__tts-btn" data-tts-text="${escapeHtml(text)}" data-tts-lang="${lang}" title="发音">🔊</button>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
