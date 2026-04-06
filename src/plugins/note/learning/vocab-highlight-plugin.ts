/**
 * VocabHighlightPlugin — 生词高亮 ProseMirror 插件
 *
 * 使用 Decoration 在文档中标注生词本中的单词（不修改文档数据）。
 * 外部通过 dispatch meta transaction 传入新词表来触发更新。
 * 鼠标悬停生词时显示释义 tooltip + TTS 按钮。
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

export const vocabHighlightPluginKey = new PluginKey('vocabHighlight');

interface VocabHighlightState {
  words: Set<string>;
  decos: DecorationSet;
}

// ─── Vocab definitions (module-level) ─────────────────────────

/** word (lowercase) → definition */
const vocabDefs = new Map<string, string>();

/** 更新生词定义（生词本变化时调用） */
export function updateVocabDefs(entries: { word: string; definition: string }[]): void {
  vocabDefs.clear();
  for (const e of entries) {
    vocabDefs.set(e.word.toLowerCase(), e.definition);
  }
}

/**
 * 触发编辑器重建生词高亮（传入新词表）
 */
export function dispatchVocabUpdate(view: EditorView, words: string[]): void {
  const tr = view.state.tr.setMeta(vocabHighlightPluginKey, new Set(words));
  view.dispatch(tr);
}

// ─── Tooltip ──────────────────────────────────────────────────

let tooltipEl: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let ttsAudio: HTMLAudioElement | null = null;
let ttsObjectUrl: string | null = null;

declare const viewAPI: {
  playTTS?: (text: string, lang: string) => Promise<ArrayBuffer | null>;
};

function handleTTS(word: string): void {
  if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
  if (ttsObjectUrl) { URL.revokeObjectURL(ttsObjectUrl); ttsObjectUrl = null; }

  viewAPI.playTTS?.(word, 'en').then((buf) => {
    if (!buf) return;
    const blob = new Blob([buf], { type: 'audio/mpeg' });
    ttsObjectUrl = URL.createObjectURL(blob);
    ttsAudio = new Audio(ttsObjectUrl);
    ttsAudio.play().catch(() => {});
  });
}

function showTooltip(word: string, rect: DOMRect): void {
  const def = vocabDefs.get(word.toLowerCase());
  if (!def) return;

  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'vocab-tooltip';
    document.body.appendChild(tooltipEl);

    tooltipEl.addEventListener('mouseenter', () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    tooltipEl.addEventListener('mouseleave', () => {
      hideTooltip();
    });
  }

  const shortDef = def.length > 200 ? def.slice(0, 200) + '...' : def;
  tooltipEl.innerHTML = `
    <div class="vocab-tooltip__header">
      <span class="vocab-tooltip__word">${escapeHtml(word)}</span>
      <button class="vocab-tooltip__tts" title="发音">&#x1f50a;</button>
    </div>
    <div class="vocab-tooltip__def">${escapeHtml(shortDef)}</div>
  `;

  const ttsBtn = tooltipEl.querySelector('.vocab-tooltip__tts');
  if (ttsBtn) {
    ttsBtn.addEventListener('click', () => handleTTS(word));
  }

  tooltipEl.style.display = 'block';
  tooltipEl.style.left = `${rect.left}px`;
  tooltipEl.style.top = `${rect.bottom + 6}px`;

  requestAnimationFrame(() => {
    if (!tooltipEl) return;
    const tr = tooltipEl.getBoundingClientRect();
    if (tr.right > window.innerWidth - 8) {
      tooltipEl.style.left = `${window.innerWidth - tr.width - 8}px`;
    }
    if (tr.bottom > window.innerHeight - 8) {
      tooltipEl.style.top = `${rect.top - tr.height - 6}px`;
    }
  });
}

function hideTooltip(): void {
  hideTimer = setTimeout(() => {
    if (tooltipEl) tooltipEl.style.display = 'none';
    hideTimer = null;
  }, 200);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Decorations ──────────────────────────────────────────────

function buildDecorations(doc: PMNode, words: Set<string>): DecorationSet {
  if (words.size === 0) return DecorationSet.empty;

  const escaped = Array.from(words).map(w =>
    w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

  const decos: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(node.text)) !== null) {
      const from = pos + match.index;
      const to = from + match[0].length;
      decos.push(
        Decoration.inline(from, to, {
          class: 'vocab-highlight',
          'data-vocab-word': match[0].toLowerCase(),
        }),
      );
    }
  });

  return DecorationSet.create(doc, decos);
}

// ─── Plugin ───────────────────────────────────────────────────

export function vocabHighlightPlugin(): Plugin {
  return new Plugin({
    key: vocabHighlightPluginKey,

    state: {
      init(): VocabHighlightState {
        return { words: new Set(), decos: DecorationSet.empty };
      },

      apply(tr, value, _oldState, newState): VocabHighlightState {
        const newWords = tr.getMeta(vocabHighlightPluginKey) as Set<string> | undefined;
        if (newWords) {
          return {
            words: newWords,
            decos: buildDecorations(newState.doc, newWords),
          };
        }
        if (tr.docChanged) {
          return {
            ...value,
            decos: buildDecorations(newState.doc, value.words),
          };
        }
        return value;
      },
    },

    props: {
      decorations(state) {
        return vocabHighlightPluginKey.getState(state)?.decos;
      },

      handleDOMEvents: {
        mouseover(_view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement;
          if (target.classList?.contains('vocab-highlight')) {
            const word = target.dataset.vocabWord || target.textContent || '';
            const rect = target.getBoundingClientRect();
            showTooltip(word, rect);
          }
          return false;
        },
        mouseout(_view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement;
          if (target.classList?.contains('vocab-highlight')) {
            hideTooltip();
          }
          return false;
        },
      },
    },
  });
}
