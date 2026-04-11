/**
 * NormalTool — 法线渲染组件（Mafs 子组件）
 *
 * 在曲线指定点处渲染法线（垂直于切线）+ 可拖动切点 + 斜率标签
 * 法线斜率 = -1 / 切线斜率
 */

import React from 'react';
import { Line, MovablePoint, Text } from 'mafs';
import type { NormalLine } from '../../types';
import { derivative } from '../math-utils';

interface NormalToolProps {
  normalLines: NormalLine[];
  evalFns: Map<string, (x: number) => number>;
  fnColors: Map<string, string>;
  onUpdate: (id: string, updates: Partial<NormalLine>) => void;
}

export const NormalTool: React.FC<NormalToolProps> = ({
  normalLines,
  evalFns,
  fnColors,
  onUpdate,
}) => {
  return (
    <>
      {normalLines.map((nl) => {
        const fn = evalFns.get(nl.functionId);
        if (!fn) return null;

        const y = fn(nl.x);
        if (!isFinite(y)) return null;

        const tangentSlope = derivative(fn, nl.x);
        if (!isFinite(tangentSlope)) return null;

        // 法线斜率 = -1/k（切线水平时法线垂直，用大斜率近似）
        const normalSlope = Math.abs(tangentSlope) < 1e-10
          ? 1e10 * (tangentSlope >= 0 ? -1 : 1)
          : -1 / tangentSlope;

        const color = nl.color || fnColors.get(nl.functionId) || '#00D4AA';

        return (
          <React.Fragment key={nl.id}>
            {/* 法线 */}
            <Line.PointSlope
              point={[nl.x, y]}
              slope={normalSlope}
              color={color}
              style="dashed"
              opacity={0.7}
            />
            {/* 法线点 — 可拖动或固定 */}
            {!nl.fixed && (
              <MovablePoint
                point={[nl.x, y]}
                onMove={([newX]) => onUpdate(nl.id, { x: newX })}
                color={color}
              />
            )}
            {/* 斜率标签 */}
            {nl.showSlope && (
              <Text
                x={nl.x}
                y={y - 0.5}
                attach="w"
                attachDistance={8}
                size={12}
                color={color}
              >
                {`k⊥ = ${normalSlope.toFixed(3)}`}
              </Text>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};
