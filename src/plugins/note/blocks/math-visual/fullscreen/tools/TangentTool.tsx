/**
 * TangentTool — 切线渲染组件（Mafs 子组件）
 *
 * 在曲线切点处渲染切线 + 可拖动切点 + 斜率标签
 */

import React from 'react';
import { Line, MovablePoint, Text } from 'mafs';
import type { TangentLine } from '../../types';
import { derivative } from '../math-utils';

interface TangentToolProps {
  tangentLines: TangentLine[];
  evalFns: Map<string, (x: number) => number>;  // functionId → evalFn
  fnColors: Map<string, string>;                  // functionId → color
  onUpdate: (id: string, updates: Partial<TangentLine>) => void;
}

export const TangentTool: React.FC<TangentToolProps> = ({
  tangentLines,
  evalFns,
  fnColors,
  onUpdate,
}) => {
  return (
    <>
      {tangentLines.map((tl) => {
        const fn = evalFns.get(tl.functionId);
        if (!fn) return null;

        const y = fn(tl.x);
        if (!isFinite(y)) return null;

        const slope = derivative(fn, tl.x);
        if (!isFinite(slope)) return null;

        const color = tl.color || fnColors.get(tl.functionId) || '#FF6B35';

        return (
          <React.Fragment key={tl.id}>
            {/* 切线 */}
            <Line.PointSlope
              point={[tl.x, y]}
              slope={slope}
              color={color}
              style="dashed"
              opacity={0.7}
            />
            {/* 切点 — 可拖动或固定 */}
            {tl.fixed ? (
              <circle cx={0} cy={0} r={0} /> // 固定点由下方 Text 旁的 dot 替代
            ) : (
              <MovablePoint
                point={[tl.x, y]}
                onMove={([newX]) => onUpdate(tl.id, { x: newX })}
                color={color}
              />
            )}
            {/* 斜率标签 */}
            {tl.showSlope && (
              <Text
                x={tl.x}
                y={y + 0.5}
                attach="e"
                attachDistance={8}
                size={12}
                color={color}
              >
                {`k = ${slope.toFixed(3)}`}
              </Text>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};
