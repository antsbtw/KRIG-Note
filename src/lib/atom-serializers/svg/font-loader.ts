import * as opentype from 'opentype.js';
import { FONT_URLS, type FontKey } from './fonts';

const cache = new Map<FontKey, Promise<opentype.Font>>();

export function loadFont(key: FontKey): Promise<opentype.Font> {
  let p = cache.get(key);
  if (p) return p;

  p = (async () => {
    const url = FONT_URLS[key];
    const t0 = performance.now();
    const buffer = await fetch(url).then((r) => r.arrayBuffer());
    const font = opentype.parse(buffer);
    const dt = performance.now() - t0;
    console.info(
      `[font-loader] ${key} loaded in ${dt.toFixed(1)}ms (${(buffer.byteLength / 1024).toFixed(0)}KB)`,
    );
    return font;
  })();

  cache.set(key, p);
  return p;
}

/** 简单 CJK 检测：U+4E00..U+9FFF 基本汉字区 + U+3400..U+4DBF + U+3000..U+303F 标点 */
export function isCjk(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef) // 全角符号
  );
}

/**
 * Mark 集合：决定使用哪种字体变体。
 *
 * 优先级（顶到底）：
 * - code: 等宽字体（覆盖 bold/italic，因为我们没装 mono bold/italic）
 * - bold + italic: 暂用 bold（没装 BoldItalic）
 * - bold: bold 字体
 * - italic: italic 字体
 * - 默认: regular
 *
 * v1.3 § 4.4.1 / spec § 4.3 mark 优先级。
 */
export interface MarkSet {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
}

/**
 * 根据字符 + mark 集合选字体：
 * - code mark: JetBrains Mono（CJK 字符 fallback 到 Noto SC，因为 mono 没中文）
 * - CJK + bold: Noto SC Bold
 * - CJK: Noto SC Regular
 * - 西文 + bold: Inter Bold
 * - 西文 + italic: Inter Italic
 * - 西文: Inter Regular
 *
 * 注：当前未装 BoldItalic 变体，bold + italic 同时存在时优先 bold；
 * 未来需要时再加 Inter-BoldItalic.ttf。
 */
export function pickFontForChar(ch: string, marks?: MarkSet): FontKey {
  const cjk = isCjk(ch);

  if (marks?.code) {
    // code mark 用等宽字体；CJK 没等宽变体，fallback Noto SC
    return cjk ? 'notoSansSc' : 'jetBrainsMono';
  }

  if (cjk) {
    return marks?.bold ? 'notoSansScBold' : 'notoSansSc';
  }

  if (marks?.bold) return 'interBold';
  if (marks?.italic) return 'interItalic';
  return 'inter';
}
