import type { BlockDef } from '../types';
import { createPlaceholder } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * tweetBlock — X(Twitter) 帖子嵌入
 *
 * 双 Tab 视图：Browse（X 官方 iframe）+ Data（结构化卡片）
 * 独立 NodeView，不继承 RenderBlock 基类
 */

// ── 工具函数 ──

/** 递归搜索对象中任意深度的 height 字段 */
function findHeight(obj: unknown, depth = 0): number | null {
  if (depth > 5 || !obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.height === 'number' && o.height > 0) return o.height;
  for (const val of Object.values(o)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        const h = findHeight(item, depth + 1);
        if (h) return h;
      }
    } else if (val && typeof val === 'object') {
      const h = findHeight(val, depth + 1);
      if (h) return h;
    }
  }
  return null;
}

function extractTweetId(url: string): string | null {
  const m = url.match(/(?:twitter\.com|x\.com)\/.+\/status\/(\d+)/);
  return m?.[1] ?? null;
}

function tweetEmbedUrl(tweetId: string): string {
  return `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}&theme=dark&dnt=true`;
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

// ── NodeView 工厂 ──

function tweetNodeView(node: PMNode, view: EditorView, getPos: () => number | undefined) {
  const dom = document.createElement('div');
  dom.classList.add('render-block', 'render-block--tweetBlock');

  const content = document.createElement('div');
  content.classList.add('render-block__content', 'tweet-block');

  const api = (window as any).viewAPI;

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
        e.preventDefault(); e.stopPropagation();
        tabBar.querySelectorAll('.tweet-block__tab-btn').forEach(b => b.classList.remove('tweet-block__tab-btn--active'));
        btn.classList.add('tweet-block__tab-btn--active');
        updateAttrs({ activeTab: tab.id });
        showTab(tab.id);
      });
      tabBar.appendChild(btn);
    }

    // ⬇️ 下载按钮（yt-dlp，不需要先 Fetch）
    let dlState: 'idle' | 'downloading' | 'done' = 'idle';
    let dlFilePath: string | null = null;
    const dlBtn = document.createElement('button');
    dlBtn.classList.add('tweet-block__fetch-btn');
    dlBtn.style.marginLeft = 'auto';
    dlBtn.textContent = '⬇️';
    dlBtn.title = 'Download video';
    dlBtn.addEventListener('mousedown', async (e) => {
      e.preventDefault(); e.stopPropagation();

      // 下载完成 → 打开文件夹
      if (dlState === 'done' && dlFilePath) {
        api?.showItemInFolder?.(dlFilePath);
        return;
      }
      if (dlState === 'downloading') return;

      // 未安装 yt-dlp → 安装
      if (!api?.ytdlpDownload) {
        if (api?.ytdlpInstall) {
          dlBtn.textContent = '⏳'; dlBtn.disabled = true;
          const r = await api.ytdlpInstall();
          if (!r?.success) { dlBtn.textContent = '❌'; setTimeout(() => { dlBtn.textContent = '⬇️'; dlBtn.disabled = false; }, 2000); return; }
          dlBtn.textContent = '⬇️'; dlBtn.disabled = false;
        }
        return;
      }

      // 下载
      dlState = 'downloading';
      dlBtn.textContent = '⏳'; dlBtn.disabled = true;
      try {
        const result = await api.ytdlpDownload(tweetUrl);
        if (result?.status === 'complete') {
          dlState = 'done';
          dlFilePath = result.filename || null;
          dlBtn.textContent = '📁';
          dlBtn.title = 'Open in Finder';
          dlBtn.disabled = false;
        } else {
          dlState = 'idle';
          dlBtn.textContent = '❌';
          setTimeout(() => { dlBtn.textContent = '⬇️'; dlBtn.disabled = false; }, 2000);
        }
      } catch {
        dlState = 'idle';
        dlBtn.textContent = '❌';
        setTimeout(() => { dlBtn.textContent = '⬇️'; dlBtn.disabled = false; }, 2000);
      }
    });
    tabBar.appendChild(dlBtn);

    // Fetch 按钮
    const fetchBtn = document.createElement('button');
    fetchBtn.classList.add('tweet-block__fetch-btn');
    fetchBtn.textContent = 'Fetch';
    fetchBtn.title = 'Fetch post metadata';
    fetchBtn.addEventListener('mousedown', async (e) => {
      e.preventDefault(); e.stopPropagation();
      fetchBtn.textContent = 'Fetching...';
      fetchBtn.classList.add('tweet-block__fetch-btn--loading');
      fetchBtn.disabled = true;
      try {
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
            buildDataCard(dataPanel, d, api);
            tabBar.querySelectorAll('.tweet-block__tab-btn').forEach(b => b.classList.remove('tweet-block__tab-btn--active'));
            tabBar.querySelectorAll('.tweet-block__tab-btn')[1]?.classList.add('tweet-block__tab-btn--active');
            showTab('data');
          }
        }
        fetchBtn.textContent = 'Fetch';
      } catch {
        fetchBtn.textContent = '❌';
        setTimeout(() => { fetchBtn.textContent = 'Fetch'; }, 2000);
      }
      fetchBtn.classList.remove('tweet-block__fetch-btn--loading');
      fetchBtn.disabled = false;
    });
    tabBar.appendChild(fetchBtn);

    // ── Browse Tab ──
    const browsePanel = document.createElement('div');
    browsePanel.classList.add('tweet-block__browse-panel');

    if (tweetId) {
      const iframe = document.createElement('iframe');
      iframe.classList.add('tweet-block__iframe');
      iframe.src = tweetEmbedUrl(tweetId);
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('scrolling', 'no');
      iframe.setAttribute('allowtransparency', 'true');
      iframe.setAttribute('allow', 'encrypted-media');

      // 监听 Twitter postMessage 动态调整高度
      const SCALE = 0.85;
      let maxHeight = 0;
      const resizeHandler = (event: MessageEvent) => {
        try {
          let data = event.data;
          if (typeof data === 'string') data = JSON.parse(data);
          if (!data || typeof data !== 'object') return;
          const height = findHeight(data);
          if (height && height > 50 && height > maxHeight) {
            maxHeight = height;
            iframe.style.height = height + 'px';
            browsePanel.style.height = Math.ceil(height * SCALE) + 'px';
          }
        } catch { /* ignore */ }
      };
      window.addEventListener('message', resizeHandler);
      (content as any)._resizeHandler = resizeHandler;

      browsePanel.appendChild(iframe);
      if (!node.attrs.tweetId) updateAttrs({ tweetId });
    } else {
      browsePanel.innerHTML = '<div class="tweet-block__no-embed">Unable to parse post ID</div>';
    }

    // ── Data Tab ──
    const dataPanel = document.createElement('div');
    dataPanel.classList.add('tweet-block__data-panel');
    dataPanel.style.display = 'none';

    // 如果已有数据，构建卡片
    if (node.attrs.authorName || node.attrs.text) {
      buildDataCard(dataPanel, node.attrs, api);
    } else {
      dataPanel.innerHTML = '<div class="tweet-block__no-data">Click "Fetch" to load post data</div>';
    }

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
      icon: '𝕏',
      embedLabel: 'Embed link',
      embedPlaceholder: 'Paste post URL (x.com or twitter.com)...',
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
      if (updatedNode.type.name !== 'tweetBlock') return false;
      node = updatedNode;
      const hasEmbed = content.querySelector('.tweet-block__tab-bar') !== null;
      const hasUrl = !!updatedNode.attrs.tweetUrl;
      if (hasEmbed !== hasUrl) return false;
      return true;
    },

    ignoreMutation(mutation: MutationRecord) {
      if (captionDOM.contains(mutation.target)) return false;
      return true;
    },

    destroy() {
      const handler = (content as any)._resizeHandler as ((e: MessageEvent) => void) | undefined;
      if (handler) window.removeEventListener('message', handler);
    },
  };
}

// ── Data Tab 卡片构建（使用 DOM API） ──

function buildDataCard(panel: HTMLElement, attrs: Record<string, unknown>, api?: Record<string, any>) {
  panel.innerHTML = '';

  const authorName = (attrs.authorName as string) || '';
  const authorHandle = (attrs.authorHandle as string) || '';
  const authorAvatar = (attrs.authorAvatar as string) || '';
  const text = (attrs.text as string) || '';
  const createdAt = (attrs.createdAt as string) || '';
  const metrics = attrs.metrics as Record<string, number> | null;
  const quotedTweet = (attrs.quotedTweet as string) || '';
  const inReplyTo = (attrs.inReplyTo as string) || '';
  const tweetUrl = (attrs.tweetUrl as string) || '';

  // 作者行
  if (authorName || authorHandle) {
    const authorRow = document.createElement('div');
    authorRow.classList.add('tweet-block__author');

    if (authorAvatar) {
      const img = document.createElement('img');
      img.src = authorAvatar;
      img.classList.add('tweet-block__avatar');
      authorRow.appendChild(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.classList.add('tweet-block__avatar-placeholder');
      placeholder.textContent = '𝕏';
      authorRow.appendChild(placeholder);
    }

    const nameEl = document.createElement('strong');
    nameEl.textContent = authorName;
    authorRow.appendChild(nameEl);

    const handleEl = document.createElement('span');
    handleEl.classList.add('tweet-block__handle');
    handleEl.textContent = ` ${authorHandle}`;
    authorRow.appendChild(handleEl);

    if (createdAt) {
      const timeEl = document.createElement('span');
      timeEl.classList.add('tweet-block__time');
      timeEl.textContent = ` · ${timeAgo(createdAt)}`;
      authorRow.appendChild(timeEl);
    }

    panel.appendChild(authorRow);
  }

  // 回复指示
  if (inReplyTo) {
    const replyEl = document.createElement('div');
    replyEl.classList.add('tweet-block__reply-to');
    replyEl.textContent = '↩ Replying to a post';
    panel.appendChild(replyEl);
  }

  // 正文
  if (text) {
    const textEl = document.createElement('div');
    textEl.classList.add('tweet-block__text');
    textEl.textContent = text;
    panel.appendChild(textEl);
  }

  // 互动数据（媒体在 Browse tab 的 iframe 中查看，Data tab 只显示文字+meta）
  if (metrics) {
    const metricsRow = document.createElement('div');
    metricsRow.classList.add('tweet-block__metrics');
    const parts: string[] = [];
    if (metrics.replies != null) parts.push(`💬 ${formatCount(metrics.replies)}`);
    if (metrics.retweets != null) parts.push(`🔁 ${formatCount(metrics.retweets)}`);
    if (metrics.likes != null) parts.push(`❤ ${formatCount(metrics.likes)}`);
    if (metrics.views != null) parts.push(`👁 ${formatCount(metrics.views)}`);
    metricsRow.textContent = parts.join('  ');
    panel.appendChild(metricsRow);
  }

  // 引用推文
  if (quotedTweet) {
    const quoteEl = document.createElement('div');
    quoteEl.classList.add('tweet-block__quoted');
    quoteEl.textContent = `Quoted: ${quotedTweet}`;
    panel.appendChild(quoteEl);
  }

  // 打开原文
  if (tweetUrl) {
    const link = document.createElement('a');
    link.classList.add('tweet-block__open-link');
    link.href = tweetUrl;
    link.target = '_blank';
    link.textContent = 'Open original ↗';
    link.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      api?.openExternal?.(tweetUrl);
    });
    panel.appendChild(link);
  }
}

// ── BlockDef ──

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
  nodeView: tweetNodeView,
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'X Post', icon: '𝕏', group: 'media', keywords: ['x', 'tweet', 'twitter', 'post', 'social', '推文'], order: 4 },
};
