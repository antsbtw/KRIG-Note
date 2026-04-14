/**
 * KaTeX 渲染辅助组件
 */

import React, { useRef, useEffect, useMemo } from 'react';
import katex from 'katex';
import * as math from 'mathjs';

/** mathjs 表达式 → LaTeX，失败时返回 null */
function exprToLatex(expression: string): string | null {
  if (!expression.trim()) return null;
  try {
    return math.parse(expression).toTex();
  } catch { /* not mathjs syntax */ }
  if (expression.includes('\\') || expression.includes('^') || expression.includes('_')) {
    return expression;
  }
  return null;
}

/** KaTeX 渲染组件 */
export function KaTeX({ tex, fallback }: { tex: string; fallback?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      katex.render(tex, ref.current, { throwOnError: false, displayMode: false });
    } catch {
      if (ref.current) ref.current.textContent = fallback || tex;
    }
  }, [tex, fallback]);
  return <span ref={ref} className="mv-fn-expr-tex" />;
}

/** 表达式的 KaTeX 展示（mathjs → LaTeX） */
export function LatexDisplay({ expression }: { expression: string }) {
  const latex = useMemo(() => exprToLatex(expression), [expression]);
  if (!latex) {
    return <span className="mv-fn-expr-text">{expression || '点击输入表达式'}</span>;
  }
  return <KaTeX tex={latex} fallback={expression} />;
}
