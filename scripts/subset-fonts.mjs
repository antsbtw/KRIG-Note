#!/usr/bin/env node
/**
 * 字体子集化脚本
 *
 * 输入：src/lib/atom-serializers/svg/fonts/NotoSansSC-Regular.ttf（约 8MB）
 * 输出：替换原文件为子集版本（目标 < 400KB）
 *
 * 子集范围（v1.3 Phase 1）：
 * - ASCII 可打印（0x20-0x7E）
 * - 中文标点 + 常用全角符号
 * - GB 2312 一级（3755 个常用汉字）
 *
 * 用法：node scripts/subset-fonts.mjs
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontDir = resolve(__dirname, '../src/lib/atom-serializers/svg/fonts');

// ── 字符集定义 ──

/** ASCII 可打印 + 西文符号 */
function asciiRange() {
  let s = '';
  for (let i = 0x20; i <= 0x7e; i++) s += String.fromCharCode(i);
  return s;
}

/** 中文标点 + 全角符号 + 常用其他符号 */
const PUNCTUATION = [
  // 全角标点（U+3000..U+303F）
  '　、。〃《》「」『』',
  '【】〔〕〖〗〘〙',
  // 全角符号（U+FF01..U+FF5E 全角拉丁，U+FFE0..U+FFEF 全角符号）
  '！＂＃＄％＆＇（）＊',
  '＋，－．／',
  '：；＜＝＞？＠',
  '［＼］＾＿｀',
  '｛｜｝～',
  // 常用数学/箭头/单位
  '—‘’“”…‰′″',
  '←↑→↓↔↕',
  '°±²³·×÷',
  '∀∂∃∅∈∉∏∑∘√∝∞',
  '∧∨∩∪∫∴∵∶',
  '≃≅≈≠≡≤≥≲≳',
  '■□▲△◆◇○●',
].join('');

/**
 * GB 2312 一级汉字字表（3755 字，按使用频率挑选的常用字）。
 *
 * 用 iconv-lite 反向枚举：GB 2312 编码区间 0xB0A1..0xD7FE（一级第 16-55 区，
 * 每区 94 个字），逐字节解码为 Unicode 字符。
 */
import iconv from 'iconv-lite';

function buildGb2312Level1Chars() {
  const chars = new Set();
  for (let qu = 16; qu <= 55; qu++) {
    for (let wei = 1; wei <= 94; wei++) {
      const b1 = 0xa0 + qu;
      const b2 = 0xa0 + wei;
      try {
        const buf = Buffer.from([b1, b2]);
        const s = iconv.decode(buf, 'gb2312');
        if (s && s.length > 0 && s.charCodeAt(0) > 0x7f) chars.add(s);
      } catch (_) {
        // 忽略不合法的字节组合
      }
    }
  }
  return [...chars].join('');
}

// ── 子集化 ──

async function subsetOne(filename, charSet) {
  const path = resolve(fontDir, filename);
  const inputSize = statSync(path).size;

  const buffer = readFileSync(path);
  const t0 = Date.now();
  const subset = await subsetFont(buffer, charSet, { targetFormat: 'truetype' });
  const dt = Date.now() - t0;

  writeFileSync(path, subset);
  const outputSize = statSync(path).size;
  console.log(
    `[subset] ${filename}: ${(inputSize / 1024).toFixed(0)}KB → ${(outputSize / 1024).toFixed(0)}KB ` +
      `(${((outputSize / inputSize) * 100).toFixed(1)}%, ${charSet.length} chars, ${dt}ms)`,
  );
}

async function subsetAll() {
  const ascii = asciiRange();
  const cjk = buildGb2312Level1Chars();
  const western = ascii + PUNCTUATION;
  const fullCjk = ascii + PUNCTUATION + cjk;

  // Inter 三字重：仅 ASCII + 西文标点（中文不画，让 NotoSansSC 接管）
  await subsetOne('Inter-Regular.ttf', western);
  await subsetOne('Inter-Bold.ttf', western);
  await subsetOne('Inter-Italic.ttf', western);

  // Noto Sans SC 两字重：ASCII + 标点 + GB 2312 一级
  await subsetOne('NotoSansSC-Regular.ttf', fullCjk);
  await subsetOne('NotoSansSC-Bold.ttf', fullCjk);

  // JetBrains Mono：仅 ASCII + 西文标点（code mark 用，中文不画）
  await subsetOne('JetBrainsMono-Regular.ttf', western);
}

// ── 入口 ──

(async () => {
  try {
    await subsetAll();
    console.log('[subset] done');
  } catch (e) {
    console.error('[subset] failed', e);
    process.exit(1);
  }
})();
