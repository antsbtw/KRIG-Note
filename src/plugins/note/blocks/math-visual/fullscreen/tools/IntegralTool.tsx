/**
 * IntegralTool — 积分区域渲染组件（Mafs 子组件）
 *
 * 渲染积分区域填充 + 可拖动边界 + 面积数值
 */

import React, { useMemo } from 'react';
import { MovablePoint, Text, useTransformContext } from 'mafs';
import type { IntegralRegion } from '../../types';
import { integrate } from '../math-utils';

interface IntegralToolProps {
  regions: IntegralRegion[];
  evalFns: Map<string, (x: number) => number>;
  fnColors: Map<string, string>;
  onUpdate: (id: string, updates: Partial<IntegralRegion>) => void;
}

/** 生成积分区域的 SVG path（函数曲线下方面积） */
function IntegralPath({
  fn,
  a,
  b,
  color,
}: {
  fn: (x: number) => number;
  a: number;
  b: number;
  color: string;
}) {
  const { viewTransform } = useTransformContext();

  const pathD = useMemo(() => {
    const steps = 100;
    const h = (b - a) / steps;
    const pts: string[] = [];

    // 从 (a, 0) 开始
    pts.push(`M ${a} 0`);
    // 沿曲线
    for (let i = 0; i <= steps; i++) {
      const x = a + i * h;
      const y = fn(x);
      if (isFinite(y)) {
        pts.push(`L ${x} ${y}`);
      }
    }
    // 回到 x 轴
    pts.push(`L ${b} 0`);
    pts.push('Z');
    return pts.join(' ');
  }, [fn, a, b]);

  // Mafs 坐标系内直接用数学坐标（viewTransform 已通过 SVG transform 处理）
  return (
    <path
      d={pathD}
      fill={color}
      fillOpacity={0.2}
      stroke={color}
      strokeWidth={1}
      strokeOpacity={0.4}
      // 修复 Mafs 的 y 轴反转：在 Mafs 的 SVG 坐标系中 y 轴是翻转的
      // 但 Mafs 内的子 SVG 元素使用数学坐标，所以直接使用即可
    />
  );
}

export const IntegralTool: React.FC<IntegralToolProps> = ({
  regions,
  evalFns,
  fnColors,
  onUpdate,
}) => {
  return (
    <>
      {regions.map((region) => {
        const fn = evalFns.get(region.functionId);
        if (!fn) return null;

        const color = region.color || fnColors.get(region.functionId) || '#2D7FF9';
        const a = Math.min(region.a, region.b);
        const b = Math.max(region.a, region.b);

        const area = integrate(fn, a, b);

        return (
          <React.Fragment key={region.id}>
            {/* 积分区域填充 */}
            <IntegralPath fn={fn} a={a} b={b} color={color} />

            {/* 左边界可拖动标记 */}
            <MovablePoint
              point={[region.a, 0]}
              onMove={([newX]) => onUpdate(region.id, { a: newX })}
              color={color}
            />
            {/* 右边界可拖动标记 */}
            <MovablePoint
              point={[region.b, 0]}
              onMove={([newX]) => onUpdate(region.id, { b: newX })}
              color={color}
            />

            {/* 面积数值 */}
            {region.showValue && isFinite(area) && (
              <Text
                x={(a + b) / 2}
                y={fn((a + b) / 2) / 2}
                size={13}
                color={color}
              >
                {`S = ${area.toFixed(4)}`}
              </Text>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};
