/**
 * resolve-ref.ts
 *
 * Turn a ClaudeArtifactRef into a concrete DOM element + form tag.
 *
 * All three ref shapes (cardEl / iframeEl / ordinal) are supported.
 * Ordinal counts *standalone* artifacts in document order: cards plus any
 * claudemcpcontent iframe that isn't nested inside a card (a card may
 * contain its own preview iframe, which shouldn't double-count).
 *
 * This code runs inside the Claude guest page via executeJavaScript, so it
 * can read the live DOM directly.
 */

import {
  CARD_ROOT_SELECTOR,
  IFRAME_SELECTOR,
} from './claude-ui-constants';
import {
  ClaudeArtifactDownloadError,
  type ClaudeArtifactRef,
} from './types';

export type ResolvedRef =
  | { form: 'card'; el: HTMLElement }
  | { form: 'iframe'; el: HTMLIFrameElement };

/**
 * Resolve a ref against the current document. Throws
 * ClaudeArtifactDownloadError('no-such-artifact') if an ordinal is out of
 * range.
 *
 * Precedence when multiple fields are set: cardEl > iframeEl > ordinal.
 */
export function resolveRef(ref: ClaudeArtifactRef, doc: Document = document): ResolvedRef {
  if (ref.cardEl) return { form: 'card', el: ref.cardEl };
  if (ref.iframeEl) return { form: 'iframe', el: ref.iframeEl };
  if (typeof ref.ordinal !== 'number') {
    throw new ClaudeArtifactDownloadError('no-such-artifact', { reason: 'ref had none of cardEl / iframeEl / ordinal' });
  }

  const list = listAllArtifacts(doc);
  const entry = list[ref.ordinal];
  if (!entry) {
    throw new ClaudeArtifactDownloadError('no-such-artifact', { ordinal: ref.ordinal, totalFound: list.length });
  }
  return entry;
}

/**
 * Scan the current document and return all artifacts in visual / document
 * order. Standalone iframes (not nested in cards) and cards are merged
 * into a single ordinal sequence.
 *
 * Exported so callers (Save-To-Note upper layer, diagnostics) can survey
 * the page without going through resolveRef.
 */
export function listAllArtifacts(doc: Document = document): ResolvedRef[] {
  const cards = Array.from(doc.querySelectorAll(CARD_ROOT_SELECTOR)) as HTMLElement[];
  const iframes = Array.from(doc.querySelectorAll(IFRAME_SELECTOR)) as HTMLIFrameElement[];
  // Exclude iframes that live inside a card (card-internal preview).
  const standaloneIframes = iframes.filter((f) => !f.closest(CARD_ROOT_SELECTOR));

  const merged: ResolvedRef[] = [
    ...cards.map((el): ResolvedRef => ({ form: 'card', el })),
    ...standaloneIframes.map((el): ResolvedRef => ({ form: 'iframe', el })),
  ];

  // Sort by document order (y then x, via compareDocumentPosition).
  merged.sort((a, b) => {
    const rel = a.el.compareDocumentPosition(b.el);
    if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  return merged;
}
