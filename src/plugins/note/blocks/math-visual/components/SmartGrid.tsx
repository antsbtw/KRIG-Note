/**
 * SmartGrid — 根据 zoom/pan 状态动态计算刻度步长的坐标网格
 * 必须作为 <Mafs> 子组件使用（依赖 useTransformContext）
 */

import React from 'react';
import { Coordinates, useTransformContext } from 'mafs';
import { calcLabelStepFromPx } from '../utils';

export function SmartGrid({
  showGrid,
  showAxes,
  showNumbers,
  userXStep,
  userYStep,
}: {
  showGrid: boolean;
  showAxes: boolean;
  showNumbers: boolean;
  userXStep: number | null;
  userYStep: number | null;
}) {
  const { viewTransform } = useTransformContext();
  const pxPerUnit = Math.abs(viewTransform[0]) || 1;
  const labelStep = calcLabelStepFromPx(pxPerUnit, 50);

  const xLabelStep = userXStep || labelStep;
  const yLabelStep = userYStep || labelStep;

  if (!showGrid && !showAxes) return null;

  return (
    <Coordinates.Cartesian
      xAxis={showAxes ? {
        lines: showGrid ? 1 : false,
        labels: showNumbers
          ? (x: number) => {
              if (Math.abs(x) < 1e-10) return '0';
              return Math.abs(x % xLabelStep) < xLabelStep * 0.01
                ? String(Math.round(x * 1000) / 1000) : '';
            }
          : false,
      } : false}
      yAxis={showAxes ? {
        lines: showGrid ? 1 : false,
        labels: showNumbers
          ? (y: number) => {
              if (Math.abs(y) < 1e-10) return '0';
              return Math.abs(y % yLabelStep) < yLabelStep * 0.01
                ? String(Math.round(y * 1000) / 1000) : '';
            }
          : false,
      } : false}
    />
  );
}
