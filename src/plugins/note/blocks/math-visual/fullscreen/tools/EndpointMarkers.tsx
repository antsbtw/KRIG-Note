/**
 * EndpointMarkers — 开闭端点标记（Mafs 子组件）
 *
 * 实心圆 ● (closed) — 彩色实心圆
 * 空心圆 ○ (open) — 白色实心圆底 + 彩色描边圆环
 *
 * 使用 useTransformContext + 原生 SVG circle，保证在曲线之上渲染。
 */

import React from 'react';
import { useTransformContext } from 'mafs';

/** 端点数据 */
export interface EndpointData {
  x: number;
  y: number;
  closed: boolean;
}

/**
 * 渲染单个端点标记。
 * 可在任何需要标注定义域/值域边界的场景中复用。
 */
export function EndpointDot({ x, y, closed, color, radius = 5, toSvg }: {
  x: number; y: number; closed: boolean; color: string; radius?: number;
  toSvg: (mx: number, my: number) => [number, number];
}) {
  const [px, py] = toSvg(x, y);
  if (closed) {
    return <circle cx={px} cy={py} r={radius} fill={color} />;
  }
  return (
    <g>
      <circle cx={px} cy={py} r={radius} fill="#fff" />
      <circle cx={px} cy={py} r={radius} fill="none" stroke={color} strokeWidth={1.5} />
    </g>
  );
}

/** 批量渲染端点标记 */
export const EndpointMarkers: React.FC<{
  endpoints: EndpointData[];
  color: string;
  radius?: number;
}> = ({ endpoints, color, radius = 5 }) => {
  const { viewTransform: m } = useTransformContext();
  // Matrix = [a, b, tx, c, d, ty]
  // px = x*a + y*b + tx, py = x*c + y*d + ty
  const toSvg = (mx: number, my: number): [number, number] => {
    return [
      mx * m[0] + my * m[1] + m[2],
      mx * m[3] + my * m[4] + m[5],
    ];
  };

  return (
    <g>
      {endpoints.map((ep, i) => (
        <EndpointDot key={`ep-${i}`}
          x={ep.x} y={ep.y} closed={ep.closed}
          color={color} radius={radius} toSvg={toSvg} />
      ))}
    </g>
  );
};
