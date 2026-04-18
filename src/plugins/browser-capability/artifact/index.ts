import type { WebContents } from 'electron';
import {
  browserCapabilityServices,
  getWebContentsForPage,
} from '../main-service';
import { browserCapabilityTraceWriter } from '../persistence';
import type {
  ArtifactRecord,
  BrowserState,
  DomAnchor,
  IBrowserArtifactAPI,
  PageInteraction,
  Rect,
  SelectionState,
} from '../types';

const INTERACTIVE_SELECTOR = 'button, a[href], input, textarea, select, summary, [role="button"], [role="link"], [role="textbox"], [contenteditable="true"]';
const DOWNLOAD_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 400;

type DownloadLocator = {
  artifact: ArtifactRecord;
  anchor?: DomAnchor;
  interaction?: PageInteraction;
};

type RankedInteraction = {
  interaction: PageInteraction;
  score: number;
  strong: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function normalizeLabel(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeArtifactToken(value?: string | null): string | null {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return token.length > 0 ? token : null;
}

function tokenizeArtifactTitle(value?: string | null): string[] {
  const token = normalizeArtifactToken(value);
  if (!token) return [];
  return token.split('_').filter((part) => part.length >= 3);
}

function isDownloadLikeInteraction(interaction: PageInteraction): boolean {
  const label = normalizeLabel(interaction.label || interaction.textPreview);
  return /download|save|export/i.test(label);
}

function rectDistance(a?: Rect | null, b?: Rect | null): number {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  const ax = a.x + (a.width / 2);
  const ay = a.y + (a.height / 2);
  const bx = b.x + (b.width / 2);
  const by = b.y + (b.height / 2);
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function scoreInteractionForArtifact(
  artifact: ArtifactRecord,
  anchor: DomAnchor | undefined,
  interaction: PageInteraction,
): RankedInteraction {
  if (interaction.visible === false || interaction.enabled === false) {
    return { interaction, score: Number.NEGATIVE_INFINITY, strong: false };
  }
  let score = 0;
  let strong = false;
  if (interaction.artifactId === artifact.artifactId) score += 300;
  if (interaction.artifactId === artifact.artifactId) strong = true;
  if (artifact.domAnchorId && interaction.anchorId === artifact.domAnchorId) {
    score += 180;
    strong = true;
  }
  if (artifact.frameId && interaction.frameId === artifact.frameId) {
    score += 120;
    strong = true;
  }
  if (interaction.surfaceScope === 'artifact') score += 40;
  if (isDownloadLikeInteraction(interaction)) score += 120;

  const label = normalizeLabel(interaction.label || interaction.textPreview);
  const artifactToken = normalizeArtifactToken(artifact.title);
  if (artifactToken && label.includes(artifactToken.replace(/_/g, ' '))) {
    score += 60;
    strong = true;
  }
  for (const token of tokenizeArtifactTitle(artifact.title)) {
    if (label.includes(token)) {
      score += 8;
      if (token.length >= 5) strong = true;
    }
  }

  if (anchor?.rect && interaction.rect) {
    score -= Math.min(120, rectDistance(anchor.rect, interaction.rect) / 10);
  }
  return { interaction, score, strong };
}

function chooseDownloadLocator(
  artifact: ArtifactRecord,
  anchors: DomAnchor[],
  interactions: PageInteraction[],
): DownloadLocator {
  const anchor = artifact.domAnchorId
    ? anchors.find((candidate) => candidate.anchorId === artifact.domAnchorId)
    : undefined;
  const ranked = interactions
    .map((interaction) => scoreInteractionForArtifact(artifact, anchor, interaction))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);

  const preferred = ranked.find((entry) => entry.strong && isDownloadLikeInteraction(entry.interaction));
  const fallback = ranked.find((entry) => entry.strong && entry.score >= 180);
  return {
    artifact,
    anchor,
    interaction: (preferred ?? fallback)?.interaction,
  };
}

async function triggerClaudeArtifactDownload(
  webContents: WebContents,
  locator: DownloadLocator,
): Promise<boolean> {
  const payload = {
    artifactTitle: locator.artifact.title ?? '',
    artifactToken: normalizeArtifactToken(locator.artifact.title),
    anchorRect: locator.anchor?.rect ?? null,
    preferredInteraction: locator.interaction
      ? {
          label: locator.interaction.label ?? locator.interaction.textPreview ?? '',
          rect: locator.interaction.rect ?? null,
          selectorHint: locator.interaction.selectorHint ?? '',
        }
      : null,
  };

  try {
    const clicked = await webContents.executeJavaScript(`
      (() => {
        const payload = ${JSON.stringify(payload)};
        const selector = ${JSON.stringify(INTERACTIVE_SELECTOR)};
        const textOf = (el) => (
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.innerText ||
          el.textContent ||
          ''
        ).trim();
        const rectOf = (el) => {
          const rect = el.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        };
        const distance = (a, b) => {
          if (!a || !b) return Number.MAX_SAFE_INTEGER;
          const ax = a.x + (a.width / 2);
          const ay = a.y + (a.height / 2);
          const bx = b.x + (b.width / 2);
          const by = b.y + (b.height / 2);
          return Math.abs(ax - bx) + Math.abs(ay - by);
        };
        const isVisible = (rect, el) => {
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || '1') === 0) return false;
          return true;
        };
        const artifactTokens = String(payload.artifactToken || '').split('_').filter((part) => part.length >= 3);
        const candidates = Array.from(document.querySelectorAll(selector))
          .map((el) => {
            const rect = rectOf(el);
            const label = textOf(el);
            const normalized = label.toLowerCase();
            if (!isVisible(rect, el)) return null;
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
            let score = 0;
            if (/download|save|export/.test(normalized)) score += 120;
            if (payload.preferredInteraction?.label) {
              const preferred = String(payload.preferredInteraction.label).trim().toLowerCase();
              if (preferred && normalized === preferred) score += 160;
              else if (preferred && normalized.includes(preferred)) score += 100;
            }
            if (payload.artifactTitle) {
              const title = String(payload.artifactTitle).trim().toLowerCase();
              if (title && normalized.includes(title)) score += 80;
            }
            for (const token of artifactTokens) {
              if (normalized.includes(token)) score += 10;
            }
            score -= Math.min(120, distance(rect, payload.preferredInteraction?.rect) / 10);
            score -= Math.min(80, distance(rect, payload.anchorRect) / 12);
            return { el, label, rect, score };
          })
          .filter(Boolean)
          .sort((left, right) => right.score - left.score);

        const target = candidates.find((candidate) => candidate.score > 40) || candidates[0];
        if (!target) return false;
        target.el.scrollIntoView({ block: 'center', inline: 'center' });
        target.el.click();
        return true;
      })();
    `, true);
    return clicked === true;
  } catch (error) {
    console.warn('[BrowserCapability][Artifact] Claude download trigger failed', {
      pageId: locator.artifact.pageId,
      artifactId: locator.artifact.artifactId,
      error,
    });
    return false;
  }
}

async function waitForNewDownload(
  pageId: string,
  baseline: Set<string>,
): Promise<BrowserState['downloads'][number] | null> {
  const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const downloads = await browserCapabilityServices.network.listDownloads(pageId);
    const next = downloads.find((download) => !baseline.has(download.downloadId));
    if (next?.status === 'completed') return next;
    if (next && (next.status === 'failed' || next.status === 'cancelled')) return next;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

class BrowserArtifactService implements IBrowserArtifactAPI {
  async probe(pageId: string, _scope?: {
    selection?: SelectionState;
    headings?: string[];
    rects?: Rect[];
  }): Promise<ArtifactRecord[]> {
    return browserCapabilityTraceWriter.getArtifacts(pageId);
  }

  async downloadAttachment(pageId: string, artifactId: string): Promise<BrowserState['downloads'][number] | null> {
    const artifact = browserCapabilityTraceWriter.getArtifacts(pageId)
      .find((candidate) => candidate.artifactId === artifactId);
    if (!artifact) return null;

    const webContents = getWebContentsForPage(pageId);
    if (!webContents || webContents.isDestroyed()) return null;

    const pageState = await browserCapabilityServices.state.getPageState(pageId).catch(() => null);
    if (!pageState?.url.includes('claude.ai')) {
      console.warn('[BrowserCapability][Artifact] downloadAttachment currently only supports Claude pages', {
        pageId,
        artifactId,
        url: pageState?.url,
      });
      return null;
    }

    const anchors = browserCapabilityTraceWriter.getAnchors(pageId);
    const interactions = browserCapabilityTraceWriter.getInteractions(pageId);
    const locator = chooseDownloadLocator(artifact, anchors, interactions);
    if (!locator.interaction) {
      console.warn('[BrowserCapability][Artifact] no strong download locator for artifact', {
        pageId,
        artifactId,
        title: artifact.title,
      });
      return null;
    }
    const baseline = new Set(
      (await browserCapabilityServices.network.listDownloads(pageId)).map((download) => download.downloadId),
    );
    const clicked = await triggerClaudeArtifactDownload(webContents, locator);
    if (!clicked) return null;
    return waitForNewDownload(pageId, baseline);
  }

  async captureVisualArtifact(pageId: string, artifactId: string): Promise<ArtifactRecord | null> {
    return browserCapabilityTraceWriter.getArtifacts(pageId)
      .find((artifact) => artifact.artifactId === artifactId) ?? null;
  }

  async resolveArtifactsForSections(pageId: string, sections: Array<{
    heading: string;
    anchor?: DomAnchor;
  }>): Promise<ArtifactRecord[]> {
    const artifacts = browserCapabilityTraceWriter.getArtifacts(pageId);
    if (sections.length === 0) return artifacts;
    const headingTokens = sections
      .map((section) => normalizeArtifactToken(section.heading))
      .filter((token): token is string => !!token);
    if (headingTokens.length === 0) return artifacts;
    return artifacts.filter((artifact) => {
      const title = normalizeArtifactToken(artifact.title);
      return !!title && headingTokens.some((token) => title.includes(token));
    });
  }
}

export const browserArtifactService = new BrowserArtifactService();
