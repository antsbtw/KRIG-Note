/**
 * probe-card-kind.ts
 *
 * Read a card's kind label (e.g. "Code · GO", "Document · MD") from its
 * DOM and classify it into a ClaudeArtifactKind.
 *
 * HTML artifacts are classified as `cardType: 'html'` rather than `'code'`
 * even though Claude labels them "Code · HTML", because the upper layer
 * routes them to a different block (html-embed) than normal code.
 */

import { CARD_KIND_LABEL_SELECTOR, CARD_TITLE_SELECTOR } from './claude-ui-constants';
import { ClaudeArtifactDownloadError, type ClaudeArtifactKind } from './types';

/**
 * Inspect a card element and return its ClaudeArtifactKind.
 * @throws ClaudeArtifactDownloadError('unknown-card-type') if the label
 *         doesn't match any known shape.
 */
export function probeCardKind(cardEl: HTMLElement): ClaudeArtifactKind {
  const labelEl = cardEl.querySelector(CARD_KIND_LABEL_SELECTOR);
  const raw = (labelEl?.textContent ?? '').trim();
  if (!raw) {
    throw new ClaudeArtifactDownloadError('unknown-card-type', { raw: '(empty)' });
  }

  // Label format: "Kind · FORMAT" with interpunct U+00B7. Tolerate stray
  // whitespace / nbsp. Also tolerate ASCII dot as a fallback.
  const parts = raw.split(/\s*[·.]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) {
    throw new ClaudeArtifactDownloadError('unknown-card-type', { raw });
  }
  const kind = parts[0].toLowerCase();
  const format = parts[1].toLowerCase();

  if (kind === 'code') {
    // HTML is a code artifact in Claude's model but needs special routing.
    if (format === 'html') return { form: 'card', cardType: 'html' };
    return { form: 'card', cardType: 'code', language: format };
  }
  if (kind === 'document') {
    return { form: 'card', cardType: 'document', format };
  }
  if (kind === 'diagram') {
    return { form: 'card', cardType: 'diagram', format };
  }
  throw new ClaudeArtifactDownloadError('unknown-card-type', { raw });
}

/**
 * Read the card's visible title (e.g. "Main", "Example").
 * Returns empty string if the title element is missing — not fatal.
 */
export function readCardTitle(cardEl: HTMLElement): string {
  const titleEl = cardEl.querySelector(CARD_TITLE_SELECTOR);
  return (titleEl?.textContent ?? '').trim();
}
