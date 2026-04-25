import type { PocNode } from './types';

const TEXT_VARIANTS = [
  'Concept',
  'Energy',
  '语义层',
  'Atom',
  '可视化',
  'Theorem',
  '思维导图',
  'GraphView',
];

const INLINE_FORMULAS = [
  'E = mc^2',
  'a^2 + b^2 = c^2',
  '\\sin^2 x + \\cos^2 x = 1',
  '\\frac{a}{b}',
  '\\sqrt{x^2 + 1}',
];

const BLOCK_FORMULAS = [
  '\\sum_{i=1}^{n} \\frac{1}{i^2}',
  '\\int_0^\\infty e^{-x^2} dx',
  '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
  '\\lim_{n \\to \\infty} \\frac{1}{n}',
];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

/**
 * 生成 N 个测试节点，按网格布局
 *
 * 内容分布：
 * - 50% 纯 textBlock（混合中英文）
 * - 30% textBlock + inline math
 * - 20% mathBlock（display math 含矩阵/求和等）
 */
export function generateNodes(count: number, gridCols = 10, spacing = 200): PocNode[] {
  const nodes: PocNode[] = [];
  const rows = Math.ceil(count / gridCols);
  const xOffset = -((gridCols - 1) * spacing) / 2;
  const yOffset = ((rows - 1) * spacing) / 2;

  for (let i = 0; i < count; i++) {
    const col = i % gridCols;
    const row = Math.floor(i / gridCols);
    const x = xOffset + col * spacing;
    const y = yOffset - row * spacing;

    const variant = i % 10;
    nodes.push({
      id: `n${i}`,
      position: { x, y },
      atoms: makeAtoms(variant, i),
    });
  }
  return nodes;
}

function makeAtoms(variant: number, seed: number): PocNode['atoms'] {
  // 0..4: 纯文字（5/10 = 50%）
  if (variant < 5) {
    return [
      {
        type: 'textBlock',
        content: [{ type: 'text', text: `${pick(TEXT_VARIANTS, seed)} ${seed}` }],
      },
    ];
  }
  // 5..7: 文字 + inline 公式（3/10 = 30%）
  if (variant < 8) {
    return [
      {
        type: 'textBlock',
        content: [
          { type: 'text', text: `${pick(TEXT_VARIANTS, seed)} = ` },
          { type: 'mathInline', attrs: { tex: pick(INLINE_FORMULAS, seed) } },
        ],
      },
    ];
  }
  // 8..9: display math（2/10 = 20%）
  return [
    { type: 'textBlock', content: [{ type: 'text', text: `${pick(TEXT_VARIANTS, seed)}：` }] },
    { type: 'mathBlock', attrs: { tex: pick(BLOCK_FORMULAS, seed) } },
  ];
}
