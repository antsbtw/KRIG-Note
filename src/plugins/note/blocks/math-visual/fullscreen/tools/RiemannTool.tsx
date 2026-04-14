/**
 * RiemannTool — 黎曼和可视化（Mafs 子组件）
 *
 * 在指定区间 [a,b] 显示 n 个矩形逼近面积。
 * 支持左端点 / 右端点 / 中点三种采样方式。
 */

import React, { useMemo } from 'react';
import { Text } from 'mafs';

export type RiemannMode = 'left' | 'right' | 'midpoint';

interface RiemannToolProps {
  fn: (x: number) => number;
  a: number;
  b: number;
  n: number;
  mode: RiemannMode;
  color: string;
  showSum: boolean;
}

export const RiemannTool: React.FC<RiemannToolProps> = ({
  fn, a, b, n, mode, color, showSum,
}) => {
  const { rects, sum } = useMemo(() => {
    if (a >= b || n <= 0) return { rects: [] as string[], sum: 0 };
    const h = (b - a) / n;
    const paths: string[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const left = a + i * h;
      let sampleX: number;
      switch (mode) {
        case 'left':    sampleX = left; break;
        case 'right':   sampleX = left + h; break;
        case 'midpoint': sampleX = left + h / 2; break;
      }
      const y = fn(sampleX);
      if (!isFinite(y)) continue;
      total += y * h;
      // 矩形四点路径（Mafs 数学坐标）
      paths.push(`M ${left} 0 L ${left} ${y} L ${left + h} ${y} L ${left + h} 0 Z`);
    }
    return { rects: paths, sum: total };
  }, [fn, a, b, n, mode]);

  return (
    <>
      {rects.map((d, i) => (
        <path
          key={i}
          d={d}
          fill={color}
          fillOpacity={0.2}
          stroke={color}
          strokeWidth={0.5}
          strokeOpacity={0.5}
        />
      ))}
      {showSum && (
        <Text x={(a + b) / 2} y={-0.5} size={12} color={color}>
          {`S ≈ ${sum.toFixed(4)} (n=${n})`}
        </Text>
      )}
    </>
  );
};
