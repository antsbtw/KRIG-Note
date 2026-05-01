import type { Atom } from '../../types';
import { textToPath } from '../text-to-path';
import type { MarkSet } from '../font-loader';
import { renderMathInline } from './mathInline';

const BASE_FONT_SIZE = 14;
const BASE_LINE_HEIGHT = 20;
const CHAR_ADVANCE_FALLBACK = 8;

const TEXT_FILL_DEFAULT = '#dddddd';
const TEXT_FILL_LINK = '#88aaff'; // 保留位（link mark 暂未实现）
const CODE_BG_FILL = '#333333';
const UNDERLINE_THICKNESS_RATIO = 1 / 16; // 字号 1/16 厚度

/**
 * Note 系统中 heading 是 textBlock 上的 level attr：
 * - null / undefined → paragraph
 * - 1 → h1
 * - 2 → h2
 * - 3 → h3
 *
 * 序列化器读 attrs.level 决定字号 / 行高，不需要单独的 heading atom 类型。
 */
function getHeadingScale(level: unknown): number {
  switch (level) {
    case 1: return 1.6;
    case 2: return 1.35;
    case 3: return 1.15;
    default: return 1;
  }
}

/**
 * 把 PM 的 marks 数组（[{ type: 'bold' }, ...]）解构成 MarkSet。
 */
function parseMarks(marksArr: unknown): MarkSet {
  if (!Array.isArray(marksArr)) return {};
  const set: MarkSet = {};
  for (const m of marksArr as Array<{ type?: string }>) {
    switch (m?.type) {
      case 'bold':
      case 'strong':
        set.bold = true;
        break;
      case 'italic':
      case 'em':
        set.italic = true;
        break;
      case 'underline':
        set.underline = true;
        break;
      case 'code':
        set.code = true;
        break;
    }
  }
  return set;
}

export async function renderTextBlock(
  atom: Atom,
  yOffset: number,
): Promise<{ svg: string; height: number }> {
  const scale = getHeadingScale(atom.attrs?.level);
  const fontSize = BASE_FONT_SIZE * scale;
  const lineHeight = BASE_LINE_HEIGHT * scale;
  // heading 自动加粗（h1/h2/h3）
  const isHeading = scale > 1;

  if (!atom.content || atom.content.length === 0) {
    return { svg: '', height: lineHeight };
  }

  const parts: string[] = [];
  let x = 4;
  const baselineY = yOffset + fontSize + 2;

  for (const inline of atom.content) {
    if (inline.type === 'text' && inline.text) {
      const marks: MarkSet = parseMarks(inline.marks);
      if (isHeading) marks.bold = true;

      // code mark 先画背景，后画文字（让文字盖在背景上）
      const codeBgWidth = marks.code ? estimateAdvance(inline.text, fontSize, marks) : 0;
      if (marks.code) {
        const padX = 2;
        const padY = 2;
        parts.push(
          `<path d="M ${x - padX} ${baselineY - fontSize - padY} h ${codeBgWidth + padX * 2} v ${fontSize + padY * 2} h -${codeBgWidth + padX * 2} Z" fill="${CODE_BG_FILL}" />`,
        );
      }

      const { svg, advance } = await textToPath(
        inline.text,
        fontSize,
        x,
        baselineY,
        TEXT_FILL_DEFAULT,
        marks,
      );

      if (svg) {
        parts.push(svg);

        // underline mark
        if (marks.underline && advance > 0) {
          const thick = Math.max(1, fontSize * UNDERLINE_THICKNESS_RATIO);
          const underlineY = baselineY + 2;
          parts.push(
            `<path d="M ${x} ${underlineY} h ${advance} v ${thick} h -${advance} Z" fill="${TEXT_FILL_DEFAULT}" />`,
          );
        }

        x += advance;
      } else {
        parts.push(fallbackPlaceholder(inline.text, x, baselineY, fontSize));
        x += inline.text.length * CHAR_ADVANCE_FALLBACK * scale;
      }
    } else if (inline.type === 'mathInline') {
      // NoteView schema 用 attrs.latex(权威源);兼容老 attrs.tex 数据
      const tex = (inline.attrs?.latex as string) ?? (inline.attrs?.tex as string) ?? '';
      const { svg, advance } = await renderMathInline(tex, fontSize, x, baselineY);
      if (svg) {
        parts.push(svg);
        x += advance;
      } else {
        parts.push(fallbackPlaceholder(`[math: ${tex}]`, x, baselineY, fontSize));
        x += tex.length * CHAR_ADVANCE_FALLBACK * scale + 8;
      }
    }
  }

  // 上面避免未使用警告
  void TEXT_FILL_LINK;

  return { svg: parts.join(''), height: lineHeight };
}

/**
 * 估算 code mark 文本的渲染宽度（用于预绘制背景，因为背景必须出现在
 * 文字 path 之前才能正确叠加）。
 *
 * code mark 优先走 JetBrains Mono（等宽 ~0.6em），CJK 走 Noto SC（~1em）。
 * 估算误差 ±10%，背景留 padX = 2px 容差吸收。
 */
function estimateAdvance(text: string, fontSize: number, _marks: MarkSet): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) w += fontSize;
    else w += fontSize * 0.6; // JetBrains Mono 等宽
  }
  return w;
}

/** 字体方案不可用时的占位 path —— 画一个小矩形让 SVGLoader 能解析出几何 */
function fallbackPlaceholder(text: string, x: number, baselineY: number, fontSize: number): string {
  const w = Math.max(text.length * 6, 10);
  const h = fontSize - 2;
  const top = baselineY - fontSize;
  return `<path d="M ${x} ${top} h ${w} v ${h} h -${w} Z" fill="#cccccc" />`;
}
