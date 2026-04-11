/**
 * AnnotationTool — 标注点渲染组件（Mafs 子组件）
 *
 * - 非选中标注：静态 Point + 坐标标签
 * - 单选标注：MovablePoint（可拖动）+ 高亮
 * - 多选标注（框选）：高亮描边
 */

import React from 'react';
import { Point, MovablePoint, Text } from 'mafs';
import type { Annotation } from '../../types';
import { ANNOTATION_LABELS } from '../../types';

interface AnnotationToolProps {
  annotations: Annotation[];
  evalFns: Map<string, (x: number) => number>;
  pointSize: number;
  selectedIdx: number | null;
  selectedIdxs: Set<number>;        // 框选多选
  onSelect: (idx: number) => void;
  onMove: (idx: number, newX: number) => void;
}

export const AnnotationTool: React.FC<AnnotationToolProps> = ({
  annotations,
  evalFns,
  pointSize,
  selectedIdx,
  selectedIdxs,
  onSelect,
  onMove,
}) => {
  return (
    <>
      {annotations.map((ann, i) => {
        const fn = evalFns.get(ann.functionId);
        if (!fn) return null;
        const y = fn(ann.x);
        if (!isFinite(y)) return null;

        const isSingleSelected = selectedIdx === i;
        const isMultiSelected = selectedIdxs.has(i);
        const color = ann.color || '#FF6B35';
        const showCoord = ann.showCoord !== false;
        const displayLabel = ann.label || ANNOTATION_LABELS[i % ANNOTATION_LABELS.length];

        return (
          <React.Fragment key={`ann-${i}`}>
            {isSingleSelected ? (
              // 单选状态：可拖动
              <MovablePoint
                point={[ann.x, y]}
                onMove={([newX]) => onMove(i, newX)}
                color={color}
              />
            ) : (
              // 非单选状态：静态点
              <Point
                x={ann.x}
                y={y}
                color={isMultiSelected ? '#fff' : color}
                svgCircleProps={{
                  r: isMultiSelected ? pointSize + 2 : pointSize,
                  stroke: isMultiSelected ? color : undefined,
                  strokeWidth: isMultiSelected ? 2 : undefined,
                  style: { cursor: 'pointer' },
                  onClick: (e: React.MouseEvent) => {
                    e.stopPropagation();
                    onSelect(i);
                  },
                }}
              />
            )}
            {/* 标签：名称 + 坐标 */}
            <Text
              x={ann.x}
              y={y}
              attach="n"
              attachDistance={pointSize + 6}
              size={11}
              color={isMultiSelected ? '#fff' : color}
            >
              {showCoord
                ? `${displayLabel} (${ann.x.toFixed(2)}, ${y.toFixed(2)})`
                : displayLabel}
            </Text>
          </React.Fragment>
        );
      })}
    </>
  );
};
