/**
 * LegendOverlay — 图例组件
 *
 * 在画布右上角显示各曲线的颜色 + 标签
 */

import React from 'react';
import type { FunctionEntry } from '../../types';

interface LegendOverlayProps {
  functions: FunctionEntry[];
}

export const LegendOverlay: React.FC<LegendOverlayProps> = ({ functions }) => {
  const visible = functions.filter((f) => f.visible);
  if (visible.length <= 1) return null;

  return (
    <div className="mv-legend-overlay">
      {visible.map((fn) => (
        <div key={fn.id} className="mv-legend-item">
          <svg width="18" height="6" className="mv-legend-svg">
            <line
              x1="0" y1="3" x2="18" y2="3"
              stroke={fn.color}
              strokeWidth={2}
              strokeDasharray={
                fn.style === 'dashed' ? '4,3' : fn.style === 'dotted' ? '2,2' : 'none'
              }
            />
          </svg>
          <span className="mv-legend-label">{fn.label}</span>
        </div>
      ))}
    </div>
  );
};
