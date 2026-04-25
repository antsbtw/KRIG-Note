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
    console.info(`[font-loader] ${key} loaded in ${dt.toFixed(1)}ms (${(buffer.byteLength / 1024).toFixed(0)}KB)`);
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

/** 根据字符自动选字体：CJK 用 Noto SC，其余用 Inter */
export function pickFontForChar(ch: string): FontKey {
  return isCjk(ch) ? 'notoSansSc' : 'inter';
}
