/**
 * svg-postprocess.ts
 *
 * Fix two issues in Claude's iframe-artifact SVG downloads:
 *
 *   1. Encoding: Claude's server writes SVGs with a latin1/utf-8 mojibake
 *      bug — utf-8 bytes are written as latin1-decoded characters, so
 *      Chinese/Japanese/Korean text appears garbled (e.g. `第一性原理`
 *      → `第ä¸æ§åç`). We detect the pattern and reverse-decode.
 *
 *   2. CSS variables: Claude SVGs use `stroke="var(--color-border-tertiary)"`
 *      etc. When embedded outside claude.ai, those variables are undefined
 *      and arrows / borders vanish. We inject a fallback `<style>` into
 *      `<defs>` with sensible default values.
 *
 * Also parses the SVG's viewBox to return a natural size hint.
 */

import { SVG_CSS_FALLBACK_VARS } from './claude-ui-constants';

export interface SvgPostProcessResult {
  bytes: Uint8Array;
  encodingFixed: boolean;
  cssFallbackInjected: boolean;
  interactivityStripped: boolean;
  naturalSize?: { w: number; h: number };
}

/**
 * Fully post-process a downloaded SVG buffer. Safe to call on
 * non-SVG bytes — it will detect and skip.
 */
export function postProcessClaudeSvg(bytes: Uint8Array): SvgPostProcessResult {
  // Decode as utf-8 first to get a working string. If the file is SVG-XML
  // this will always yield a valid JS string (every byte is some char).
  const rawText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

  // Quick sniff: is this actually SVG?
  if (!/<svg[\s>]/i.test(rawText)) {
    return { bytes, encodingFixed: false, cssFallbackInjected: false, interactivityStripped: false };
  }

  let text = rawText;

  // Step 1: encoding fix.
  const fixed = tryFixMojibake(text);
  const encodingFixed = fixed.fixed !== null;
  if (encodingFixed) text = fixed.fixed!;

  // Step 2: CSS fallback injection.
  const injected = injectCssFallback(text);
  text = injected.text;
  const cssFallbackInjected = injected.injected;

  // Step 3: strip Claude's page-only interactivity (onclick handlers,
  // inline script tags). These often contain unescaped quotes inside XML
  // attributes, which makes the exported SVG invalid as a standalone file.
  const stripped = stripInteractiveSvgBits(text);
  text = stripped.text;

  // Step 4: parse natural size from viewBox.
  const naturalSize = parseViewBox(text);

  const outBytes = new TextEncoder().encode(text);
  return {
    bytes: outBytes,
    encodingFixed,
    cssFallbackInjected,
    interactivityStripped: stripped.changed,
    naturalSize,
  };
}

// ─────────────────────────────────────────────────────────────
// Mojibake detection + reversal
// ─────────────────────────────────────────────────────────────

/**
 * If `text` looks like utf-8-interpreted-as-latin1 (i.e. contains runs of
 * byte sequences that spell CJK when re-decoded), reverse the damage.
 *
 * Returns { fixed: string } if a correction was applied and verified, or
 * { fixed: null } if no correction was needed or the correction didn't
 * pass validation.
 */
export function tryFixMojibake(text: string): { fixed: string | null } {
  // Mojibake signature: two or three consecutive bytes in the
  // latin1-supplement range (0xc2-0xef followed by 0x80-0xbf), which is
  // exactly how utf-8 CJK encodes.
  const sig = /[\u00c2-\u00ef][\u0080-\u00bf]{1,2}/;
  if (!sig.test(text)) return { fixed: null };

  // Re-encode every codepoint as a single byte (latin1 round-trip), then
  // decode those bytes as utf-8.
  try {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c > 0xff) {
        // Out of latin1 range — not a clean mojibake case. Abort.
        return { fixed: null };
      }
      bytes[i] = c;
    }
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Validation: did we actually get readable CJK / non-ASCII out?
    if (/[\u3000-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(decoded)) {
      return { fixed: decoded };
    }
    return { fixed: null };
  } catch {
    return { fixed: null };
  }
}

// ─────────────────────────────────────────────────────────────
// CSS variable fallback injection
// ─────────────────────────────────────────────────────────────

export function injectCssFallback(svg: string): { text: string; injected: boolean } {
  // Build the fallback :root block.
  const vars = Object.entries(SVG_CSS_FALLBACK_VARS)
    .map(([k, v]) => `    ${k}: ${v};`)
    .join('\n');
  const style = `<style id="krig-svg-fallback-vars">\n  :root {\n${vars}\n  }\n</style>`;

  // Prefer injecting inside an existing <defs>. If none, insert right
  // after the opening <svg ...>. SVG 1.1 allows <style> inside <svg>.
  const defsMatch = svg.match(/<defs\b[^>]*>/);
  if (defsMatch) {
    const insertAt = defsMatch.index! + defsMatch[0].length;
    return {
      text: svg.slice(0, insertAt) + '\n' + style + svg.slice(insertAt),
      injected: true,
    };
  }
  const svgMatch = svg.match(/<svg\b[^>]*>/);
  if (svgMatch) {
    const insertAt = svgMatch.index! + svgMatch[0].length;
    return {
      text: svg.slice(0, insertAt) + '\n<defs>' + style + '</defs>' + svg.slice(insertAt),
      injected: true,
    };
  }
  return { text: svg, injected: false };
}

// ─────────────────────────────────────────────────────────────
// Interactivity stripping
// ─────────────────────────────────────────────────────────────

export function stripInteractiveSvgBits(svg: string): { text: string; changed: boolean } {
  let text = svg;
  let changed = false;

  const withoutScripts = text.replace(/<script\b[\s\S]*?<\/script>/gi, () => {
    changed = true;
    return '';
  });
  text = withoutScripts;

  // Remove inline event handler attributes. Claude exports interactive SVG
  // with malformed handlers like:
  //   onclick="sendPrompt('什么叫" 无法再分解"的基本事实？')"=""
  // so a simple `on...="[^"]*"` removal is not enough: the embedded quotes
  // split the attribute and leave garbage behind. First strip the whole
  // event-attribute segment up to the next normal attribute / tag end.
  text = text.replace(
    /(<[a-zA-Z][^>]*?)\s+on[a-zA-Z-]+\s*=\s*"[\s\S]*?(?=\s+(?:style|class|id|fill|stroke|transform|x|y|width|height|rx|ry|d|points|viewBox|xmlns)\s*=|\s*\/?>)/g,
    (_m, prefix) => {
      changed = true;
      return prefix;
    },
  );

  // Fallback cleanup for well-formed event attrs that weren't caught above.
  const attrPatterns = [
    /\s+on[a-zA-Z-]+\s*=\s*"[^"]*"/g,
    /\s+on[a-zA-Z-]+\s*=\s*'[^']*'/g,
    /\s+on[a-zA-Z-]+\s*=\s*[^\s>]+/g,
  ];
  for (const pattern of attrPatterns) {
    text = text.replace(pattern, () => {
      changed = true;
      return '';
    });
  }

  // Remove the most common broken remnants left after event stripping.
  const fragmentPatterns = [
    /\s+=""(?=[\s>])/g,
    /\s+sendPrompt\([^>]*?(?=\s+(?:style|class|id|fill|stroke|transform|x|y|width|height|rx|ry|d|points|viewBox|xmlns)\s*=|\s*\/?>)/g,
    /\s+"[^"]*"\)\s*""(?=[\s>])/g,
  ];
  for (const pattern of fragmentPatterns) {
    text = text.replace(pattern, () => {
      changed = true;
      return '';
    });
  }

  return { text, changed };
}

// ─────────────────────────────────────────────────────────────
// viewBox parsing
// ─────────────────────────────────────────────────────────────

export function parseViewBox(svg: string): { w: number; h: number } | undefined {
  const m = svg.match(/<svg\b[^>]*\sviewBox=["']\s*([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s*["']/);
  if (!m) return undefined;
  const w = parseFloat(m[3]);
  const h = parseFloat(m[4]);
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return undefined;
  return { w, h };
}
