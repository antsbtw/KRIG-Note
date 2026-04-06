import { net } from 'electron';

/**
 * Google Translate 免费端点
 *
 * 使用 translate.googleapis.com 非官方端点。
 * 用 Electron net.fetch（遵循系统代理设置）。
 */

export interface TranslateResult {
  text: string;
  sourceLang: string;
  targetLang: string;
}

export async function googleTranslate(
  text: string,
  targetLang = 'zh-CN',
  sourceLang = 'auto',
): Promise<TranslateResult | null> {
  try {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: sourceLang,
      tl: targetLang,
      dt: 't',
      q: text,
    });

    const url = `https://translate.googleapis.com/translate_a/single?${params}`;
    const response = await net.fetch(url);

    if (!response.ok) return null;

    const data = await response.json();

    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;

    const translated = (data[0] as unknown[][])
      .filter(seg => Array.isArray(seg) && typeof seg[0] === 'string')
      .map(seg => seg[0] as string)
      .join('');

    if (!translated) return null;

    const detectedLang = (typeof data[2] === 'string' ? data[2] : sourceLang) as string;

    return { text: translated, sourceLang: detectedLang, targetLang };
  } catch {
    return null;
  }
}

/**
 * Google TTS — 文字转语音
 *
 * 返回 MP3 音频 Buffer。长文本按句子边界分块。
 */
export async function googleTTS(text: string, lang: string): Promise<Buffer | null> {
  try {
    const chunks = splitTextForTTS(text, 180);
    const buffers: Buffer[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(chunks[i])}&idx=${i}&total=${chunks.length}&textlen=${chunks[i].length}&client=tw-ob&prev=input&ttsspeed=1`;
      const resp = await net.fetch(url, {
        headers: {
          'Referer': 'https://translate.google.com/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      if (!resp.ok) return null;
      buffers.push(Buffer.from(await resp.arrayBuffer()));
    }

    return Buffer.concat(buffers);
  } catch {
    return null;
  }
}

function splitTextForTTS(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = -1;
    for (let i = maxLen - 1; i >= maxLen / 2; i--) {
      if ('.!?;。！？；'.includes(remaining[i])) {
        splitIdx = i + 1;
        break;
      }
    }
    if (splitIdx === -1) {
      splitIdx = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitIdx <= 0) {
      splitIdx = maxLen;
    }
    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks.filter(c => c.length > 0);
}
