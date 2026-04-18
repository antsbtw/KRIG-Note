/**
 * Claude Artifact placeholder processing.
 *
 * Live chat sync path: replaces artifact placeholders with a friendly
 * callout asking the user to use the extraction feature.
 *
 * The old DOM-simulation "full" path (processClaudeArtifactsFull) has
 * been removed. Artifact content is now obtained from the conversation
 * API via Browser Capability Layer — see Artifact-Import-设计.md.
 */

import {
  countArtifactPlaceholders,
  replaceArtifactPlaceholders,
  trimLeadingArtifactPlaceholder,
} from '../../web-bridge/capabilities/claude-api-extractor';

/**
 * Live chat path: never invoke CDP. Replace any placeholder with a
 * "go click Claude's copy button" callout so the user knows where the
 * artifact would have been.
 */
export function processClaudeArtifactsLive(
  assistantMsg: string,
  conversationUrl: string,
): string {
  const normalizedMsg = trimLeadingArtifactPlaceholder(assistantMsg);
  if (countArtifactPlaceholders(normalizedMsg) === 0) return normalizedMsg;
  return replaceArtifactPlaceholders(normalizedMsg, conversationUrl);
}
