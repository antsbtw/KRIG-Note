/**
 * HoverCoords — 鼠标悬停时显示曲线上的 (x, y) 坐标
 *
 * 在 Mafs 画布上监听鼠标位置，找到最近的曲线上的 y 值并显示。
 * 使用 Mafs 的 useTransformContext 将像素坐标转换为数学坐标。
 */

import React, { useState, useCallback } from 'react';
import { useTransformContext, Point, Text } from 'mafs';

interface HoverCoordsProps {
  evalFns: Map<string, (x: number) => number>;
  fnColors: Map<string, string>;
  visibleFnIds: Set<string>;
}

export const HoverCoords: React.FC<HoverCoordsProps> = ({
  evalFns,
  fnColors,
  visibleFnIds,
}) => {
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number; color: string } | null>(null);
  const { viewTransform } = useTransformContext();

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGGElement>) => {
    const svg = (e.target as SVGElement).ownerSVGElement;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;

    // SVG 像素 → 数学坐标（viewTransform 是 [scaleX, 0, 0, scaleY, translateX, translateY]）
    const scaleX = viewTransform[0];
    const scaleY = viewTransform[3];
    const tx = viewTransform[4];
    const ty = viewTransform[5];

    if (Math.abs(scaleX) < 1e-10) return;
    const mathX = (svgX - tx) / scaleX;

    // 找最近的曲线 y 值
    let bestY = NaN;
    let bestDist = Infinity;
    let bestColor = '#FF6B35';
    const mathY = (svgY - ty) / scaleY;

    for (const [fnId, evalFn] of evalFns) {
      if (!visibleFnIds.has(fnId)) continue;
      const y = evalFn(mathX);
      if (!isFinite(y)) continue;
      const dist = Math.abs(y - mathY);
      if (dist < bestDist) {
        bestDist = dist;
        bestY = y;
        bestColor = fnColors.get(fnId) || '#FF6B35';
      }
    }

    // 只在足够近时显示（数学坐标距离 < 视口高度的 10%）
    const viewHeight = Math.abs(rect.height / scaleY);
    if (isFinite(bestY) && bestDist < viewHeight * 0.1) {
      setHoverPoint({ x: mathX, y: bestY, color: bestColor });
    } else {
      setHoverPoint(null);
    }
  }, [evalFns, fnColors, visibleFnIds, viewTransform]);

  const handleMouseLeave = useCallback(() => setHoverPoint(null), []);

  return (
    <>
      {/* 透明覆盖层捕获鼠标事件 */}
      <g
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ pointerEvents: 'all' }}
      >
        <rect x={-1e6} y={-1e6} width={2e6} height={2e6} fill="transparent" />
      </g>
      {hoverPoint && (
        <>
          <Point x={hoverPoint.x} y={hoverPoint.y} color={hoverPoint.color} svgCircleProps={{ r: 4 }} />
          <Text
            x={hoverPoint.x}
            y={hoverPoint.y}
            attach="s"
            attachDistance={12}
            size={11}
            color={hoverPoint.color}
          >
            {`(${hoverPoint.x.toFixed(3)}, ${hoverPoint.y.toFixed(3)})`}
          </Text>
        </>
      )}
    </>
  );
};
