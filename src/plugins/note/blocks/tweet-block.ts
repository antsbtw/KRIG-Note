import type { BlockDef } from '../types';
import { createRenderBlockView, createPlaceholder, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * tweetBlock — 推文嵌入（RenderBlock）
 *
 * 双 Tab 视图：Browse（Twitter 官方 iframe）+ Data（结构化卡片）
 */

// ── 工具函数 ──

function extractTweetId(url: string): string | null {
  const m = url.match(/(?:twitter\.com|x\.com)\/.+\/status\/(\d+)/);
  return m?.[1] ?? null;
}

function tweetEmbedUrl(tweetId: string): string {
  return `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}&theme=dark`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ── Renderer ──

const tweetRenderer: RenderBlockRenderer = {
  label() { return 'Tweet'; },

  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('tweet-block');

    const updateAttrs = (attrs: Record<string, unknown>) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      let tr = view.state.tr;
      for (const [key, value] of Object.entries(attrs)) {
        tr = tr.setNodeAttribute(pos, key, value);
      }
      view.dispatch(tr);
    };

    const tweetUrl = node.attrs.tweetUrl as string | null;

    if (tweetUrl) {
      const tweetId = (node.attrs.tweetId as string) || extractTweetId(tweetUrl);

      // ── Tab 栏 ──
      const tabBar = document.createElement('div');
      tabBar.classList.add('tweet-block__tab-bar');

      const activeTab = (node.attrs.activeTab as string) || 'browse';

      const tabs = [
        { id: 'browse', label: 'Browse' },
        { id: 'data', label: 'Data' },
      ];

      for (const tab of tabs) {
        const btn = document.createElement('button');
        btn.classList.add('tweet-block__tab-btn');
        if (tab.id === activeTab) btn.classList.add('tweet-block__tab-btn--active');
        btn.textContent = tab.label;
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          tabBar.querySelectorAll('.tweet-block__tab-btn').forEach(b => b.classList.remove('tweet-block__tab-btn--active'));
          btn.classList.add('tweet-block__tab-btn--active');
          updateAttrs({ activeTab: tab.id });
          showTab(tab.id);
        });
        tabBar.appendChild(btn);
      }

      // Fetch 按钮
      const fetchBtn = document.createElement('button');
      fetchBtn.classList.add('tweet-block__fetch-btn');
      fetchBtn.textContent = 'Fetch';
      fetchBtn.title = 'Fetch tweet metadata';
      fetchBtn.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        fetchBtn.textContent = '⏳';
        fetchBtn.disabled = true;
        try {
          const api = (window as any).viewAPI;
          if (api?.fetchTweetData) {
            const result = await api.fetchTweetData(tweetUrl);
            if (result?.success && result.data) {
              const d = result.data;
              updateAttrs({
                authorName: d.authorName || '',
                authorHandle: d.authorHandle || '',
                authorAvatar: d.authorAvatar || '',
                text: d.text || '',
                createdAt: d.createdAt || '',
                lang: d.lang || '',
                media: d.media || null,
                metrics: d.metrics || null,
                quotedTweet: d.quotedTweet || null,
                inReplyTo: d.inReplyTo || null,
                activeTab: 'data',
              });
              // 刷新 Data Tab
              buildDataCard(dataPanel, { ...node, attrs: { ...node.attrs, ...d } } as any);
              // 切换到 Data Tab
              tabBar.querySelectorAll('.tweet-block__tab-btn').forEach(b => b.classList.remove('tweet-block__tab-btn--active'));
              tabBar.querySelectorAll('.tweet-block__tab-btn')[1]?.classList.add('tweet-block__tab-btn--active');
              showTab('data');
            }
          }
          fetchBtn.textContent = 'Fetch';
          fetchBtn.disabled = false;
        } catch {
          fetchBtn.textContent = '❌';
          setTimeout(() => { fetchBtn.textContent = 'Fetch'; fetchBtn.disabled = false; }, 2000);
        }
      });
      tabBar.appendChild(fetchBtn);

      // ── Browse Tab ──
      const browsePanel = document.createElement('div');
      browsePanel.classList.add('tweet-block__browse-panel');

      if (tweetId) {
        const iframe = document.createElement('iframe');
        iframe.src = tweetEmbedUrl(tweetId);
        iframe.style.cssText = 'width:100%; min-height:250px; border:none; border-radius:4px;';
        iframe.setAttribute('scrolling', 'no');

        // 监听 Twitter postMessage 动态调整高度
        const resizeHandler = (event: MessageEvent) => {
          if (typeof event.data === 'object' && event.data['twttr.embed']) {
            try {
              const height = event.data['twttr.embed']?.params?.height;
              if (height) iframe.style.height = `${height}px`;
            } catch { /* ignore */ }
          }
        };
        window.addEventListener('message', resizeHandler);
        (content as any)._resizeHandler = resizeHandler;

        browsePanel.appendChild(iframe);
        // 保存 tweetId
        if (!node.attrs.tweetId) updateAttrs({ tweetId });
      } else {
        browsePanel.innerHTML = '<div class="tweet-block__no-embed">Unable to parse tweet ID</div>';
      }

      // ── Data Tab ──
      const dataPanel = document.createElement('div');
      dataPanel.classList.add('tweet-block__data-panel');
      dataPanel.style.display = 'none';

      buildDataCard(dataPanel, node);

      // Tab 切换
      function showTab(tabId: string) {
        browsePanel.style.display = tabId === 'browse' ? 'block' : 'none';
        dataPanel.style.display = tabId === 'data' ? 'block' : 'none';
      }
      showTab(activeTab);

      content.appendChild(tabBar);
      content.appendChild(browsePanel);
      content.appendChild(dataPanel);
    } else {
      // ── Placeholder ──
      const placeholder = createPlaceholder({
        icon: '🐦',
        embedLabel: 'Embed link',
        embedPlaceholder: 'Paste tweet URL (twitter.com or x.com)...',
        onEmbed: (url) => {
          const id = extractTweetId(url);
          updateAttrs({ tweetUrl: url, tweetId: id });
        },
      });
      content.appendChild(placeholder);
    }

    // ── Caption ──
    const captionDOM = document.createElement('div');
    captionDOM.classList.add('tweet-block__caption');
    content.appendChild(captionDOM);
    (content as any)._captionDOM = captionDOM;

    return content;
  },

  update(node: PMNode, contentEl: HTMLElement): boolean {
    // 状态切换（placeholder ↔ embed）→ 重建 NodeView
    const hasEmbed = contentEl.querySelector('.tweet-block__tab-bar') !== null;
    const hasUrl = !!node.attrs.tweetUrl;
    if (hasEmbed !== hasUrl) return false;
    return true;
  },

  getContentDOM(contentEl: HTMLElement) {
    return (contentEl as any)._captionDOM as HTMLElement;
  },

  destroy(contentEl: HTMLElement) {
    const handler = (contentEl as any)._resizeHandler as ((e: MessageEvent) => void) | undefined;
    if (handler) window.removeEventListener('message', handler);
  },
};

/** 构建 Data Tab 卡片 */
function buildDataCard(panel: HTMLElement, node: PMNode) {
  const authorName = node.attrs.authorName as string;
  const authorHandle = node.attrs.authorHandle as string;
  const text = node.attrs.text as string;
  const createdAt = node.attrs.createdAt as string;
  const metrics = node.attrs.metrics as Record<string, number> | null;
  const media = node.attrs.media as Array<{ type: string; url: string; thumbUrl?: string }> | null;
  const quotedTweet = node.attrs.quotedTweet as string | null;
  const inReplyTo = node.attrs.inReplyTo as string | null;

  if (!authorName && !text) {
    panel.innerHTML = '<div class="tweet-block__no-data">Click "Fetch" to load tweet data</div>';
    return;
  }

  let html = '';

  // 作者行
  if (authorName || authorHandle) {
    const avatar = node.attrs.authorAvatar
      ? `<img src="${node.attrs.authorAvatar}" class="tweet-block__avatar" />`
      : '<span class="tweet-block__avatar-placeholder">🐦</span>';
    const time = createdAt ? ` · ${timeAgo(createdAt)}` : '';
    html += `<div class="tweet-block__author">${avatar}<strong>${authorName}</strong> <span class="tweet-block__handle">${authorHandle}</span>${time}</div>`;
  }

  // 回复指示
  if (inReplyTo) html += `<div class="tweet-block__reply-to">↩ Replying to a tweet</div>`;

  // 正文
  if (text) html += `<div class="tweet-block__text">${escapeHtml(text)}</div>`;

  // 媒体网格
  if (media && media.length > 0) {
    html += '<div class="tweet-block__media-grid">';
    for (const item of media) {
      const thumb = item.thumbUrl || item.url;
      html += `<div class="tweet-block__media-item"><img src="${thumb}" /></div>`;
    }
    html += '</div>';
  }

  // 互动数据
  if (metrics) {
    const parts = [];
    if (metrics.replies != null) parts.push(`💬 ${formatCount(metrics.replies)}`);
    if (metrics.retweets != null) parts.push(`🔁 ${formatCount(metrics.retweets)}`);
    if (metrics.likes != null) parts.push(`❤ ${formatCount(metrics.likes)}`);
    if (metrics.views != null) parts.push(`👁 ${formatCount(metrics.views)}`);
    if (parts.length) html += `<div class="tweet-block__metrics">${parts.join('  ')}</div>`;
  }

  // 引用推文
  if (quotedTweet) html += `<div class="tweet-block__quoted">Quoted: ${escapeHtml(quotedTweet)}</div>`;

  // 打开原文
  const tweetUrl = node.attrs.tweetUrl as string;
  if (tweetUrl) html += `<a class="tweet-block__open-link" href="${tweetUrl}" target="_blank">Open original ↗</a>`;

  panel.innerHTML = html;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const tweetBlockBlock: BlockDef = {
  name: 'tweetBlock',
  group: 'block',
  nodeSpec: {
    content: 'textBlock',
    group: 'block',
    draggable: true,
    selectable: true,
    attrs: {
      atomId:        { default: null },
      sourcePages:   { default: null },
      thoughtId:     { default: null },
      tweetUrl:      { default: null },
      tweetId:       { default: null },
      embedHtml:     { default: null },
      authorName:    { default: '' },
      authorHandle:  { default: '' },
      authorAvatar:  { default: '' },
      text:          { default: '' },
      richText:      { default: null },
      createdAt:     { default: '' },
      lang:          { default: '' },
      media:         { default: null },
      metrics:       { default: null },
      quotedTweet:   { default: null },
      inReplyTo:     { default: null },
      activeTab:     { default: 'browse' },
    },
    parseDOM: [{ tag: 'div.tweet-block' }],
    toDOM() { return ['div', { class: 'tweet-block' }, 0]; },
  },
  nodeView: createRenderBlockView(tweetRenderer, 'tweetBlock'),
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'Tweet', icon: '🐦', group: 'media', keywords: ['tweet', 'twitter', 'x', 'social', '推文'], order: 4 },
};
