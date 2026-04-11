/**
 * InlineEndpoints — 端点标记（开/闭圆点）
 * 必须作为 <Mafs> 子组件使用（依赖 useTransformContext）
 */

import React from 'react';
import { useTransformContext } from 'mafs';

export function InlineEndpoints({ endpoints, color }: {
  endpoints: Array<{ x: number; y: number; closed: boolean }>;
  color: string;
}) {
  const { viewTransform: m } = useTransformContext();
  return (
    <g>
      {endpoints.map((ep, i) => {
        const px = ep.x * m[0] + ep.y * m[1] + m[2];
        const py = ep.x * m[3] + ep.y * m[4] + m[5];
        if (ep.closed) {
          return <circle key={i} cx={px} cy={py} r={5} fill={color} />;
        }
        return (
          <g key={i}>
            <circle cx={px} cy={py} r={5} fill="#fff" />
            <circle cx={px} cy={py} r={5} fill="none" stroke={color} strokeWidth={1.5} />
          </g>
        );
      })}
    </g>
  );
}
