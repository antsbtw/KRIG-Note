import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * AnnotationLayer — 空间标注覆盖层（单页）
 *
 * 放在每个 page-wrapper 中，覆盖在 canvas 和 textLayer 之上。
 * 处理：拖拽画框（rect / underline）、显示已有标注、颜色选择。
 */

export interface Annotation {
  id: string;
  type: 'rect' | 'underline';
  color: string;
  // 坐标基于 scale=1 的页面尺寸
  rect: { x: number; y: number; w: number; h: number };
}

interface AnnotationLayerProps {
  pageNum: number;
  scale: number;
  pageWidth: number;   // scale=1 时的页面宽度
  pageHeight: number;  // scale=1 时的页面高度
  mode: 'off' | 'rect' | 'underline';
  annotations: Annotation[];
  onAnnotationCreate: (pageNum: number, annotation: Omit<Annotation, 'id'>) => void;
  onAnnotationDelete: (id: string) => void;
}

const COLORS = ['#ffd43b', '#69db7c', '#74c0fc', '#b197fc', '#ff6b6b'];
const UNDERLINE_HEIGHT = 3; // 横线高度（scale=1 下的像素）

export function AnnotationLayer({
  pageNum, scale, pageWidth, pageHeight, mode, annotations,
  onAnnotationCreate, onAnnotationDelete,
}: AnnotationLayerProps) {
  // 拖拽状态
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });
  const layerRef = useRef<HTMLDivElement>(null);

  // 颜色选择浮动工具栏
  const [colorPicker, setColorPicker] = useState<{
    rect: { x: number; y: number; w: number; h: number };
    type: 'rect' | 'underline';
  } | null>(null);

  // 获取鼠标在 scale=1 坐标系中的位置
  const getScaledPos = useCallback((e: React.MouseEvent) => {
    const el = layerRef.current;
    if (!el) return { x: 0, y: 0 };
    const bounds = el.getBoundingClientRect();
    return {
      x: (e.clientX - bounds.left) / scale,
      y: (e.clientY - bounds.top) / scale,
    };
  }, [scale]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (mode === 'off') return;
    e.preventDefault();
    const pos = getScaledPos(e);
    setStartPos(pos);
    setCurrentPos(pos);
    setDrawing(true);
  }, [mode, getScaledPos]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drawing) return;
    setCurrentPos(getScaledPos(e));
  }, [drawing, getScaledPos]);

  const handleMouseUp = useCallback(() => {
    if (!drawing) return;
    setDrawing(false);

    const x = Math.min(startPos.x, currentPos.x);
    const y = Math.min(startPos.y, currentPos.y);
    const w = Math.abs(currentPos.x - startPos.x);
    const h = mode === 'underline' ? UNDERLINE_HEIGHT : Math.abs(currentPos.y - startPos.y);

    // 最小尺寸检查（防止误触）
    if (w < 5 || (mode === 'rect' && h < 5)) return;

    const rect = mode === 'underline'
      ? { x, y: startPos.y, w, h: UNDERLINE_HEIGHT }
      : { x, y, w, h };

    // 显示颜色选择
    setColorPicker({ rect, type: mode as 'rect' | 'underline' });
  }, [drawing, startPos, currentPos, mode]);

  // 点击空白关闭颜色选择
  useEffect(() => {
    if (!colorPicker) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.annotation-color-picker')) {
        setColorPicker(null);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [colorPicker]);

  const handleColorSelect = useCallback((color: string) => {
    if (!colorPicker) return;
    onAnnotationCreate(pageNum, {
      type: colorPicker.type,
      color,
      rect: colorPicker.rect,
    });
    setColorPicker(null);
  }, [colorPicker, pageNum, onAnnotationCreate]);

  // 当前绘制中的预览矩形
  const previewRect = drawing ? (() => {
    const x = Math.min(startPos.x, currentPos.x);
    const y = Math.min(startPos.y, currentPos.y);
    const w = Math.abs(currentPos.x - startPos.x);
    const h = mode === 'underline' ? UNDERLINE_HEIGHT : Math.abs(currentPos.y - startPos.y);
    return mode === 'underline'
      ? { x, y: startPos.y, w, h: UNDERLINE_HEIGHT }
      : { x, y, w, h };
  })() : null;

  return (
    <div
      ref={layerRef}
      className="annotation-layer"
      style={{
        cursor: mode !== 'off' ? 'crosshair' : 'default',
        pointerEvents: mode !== 'off' ? 'auto' : 'none',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { if (drawing) setDrawing(false); }}
    >
      {/* 已有标注 */}
      {annotations.map((ann) => (
        <div
          key={ann.id}
          className={`annotation annotation--${ann.type}`}
          style={{
            left: ann.rect.x * scale,
            top: ann.rect.y * scale,
            width: ann.rect.w * scale,
            height: ann.rect.h * scale,
            backgroundColor: ann.type === 'rect'
              ? `${ann.color}33`  // 20% opacity
              : ann.color,
            borderColor: ann.type === 'rect' ? ann.color : 'transparent',
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAnnotationDelete(ann.id);
          }}
        />
      ))}

      {/* 绘制中的预览 */}
      {previewRect && (
        <div
          className={`annotation annotation--preview annotation--${mode}`}
          style={{
            left: previewRect.x * scale,
            top: previewRect.y * scale,
            width: previewRect.w * scale,
            height: previewRect.h * scale,
          }}
        />
      )}

      {/* 颜色选择浮动工具栏 */}
      {colorPicker && (
        <div
          className="annotation-color-picker"
          style={{
            left: colorPicker.rect.x * scale,
            top: (colorPicker.rect.y + colorPicker.rect.h) * scale + 8,
          }}
        >
          {COLORS.map((c) => (
            <button
              key={c}
              className="annotation-color-picker__btn"
              style={{ backgroundColor: c }}
              onClick={(e) => { e.stopPropagation(); handleColorSelect(c); }}
            />
          ))}
          <button
            className="annotation-color-picker__cancel"
            onClick={(e) => { e.stopPropagation(); setColorPicker(null); }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
