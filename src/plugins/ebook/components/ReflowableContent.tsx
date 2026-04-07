import { useRef, useEffect } from 'react';
import type { IReflowableRenderer } from '../types';

interface ReflowableContentProps {
  renderer: IReflowableRenderer;
  onPageChange: (page: number) => void;
}

/**
 * ReflowableContent — 可重排格式的渲染容器（EPUB）
 *
 * 通过 IReflowableRenderer 接口渲染内容。
 * 渲染引擎（epub.js / foliate-js）将内容注入到容器 DOM 中。
 *
 * 与 FixedPageContent 的核心差异：
 * - 没有固定页面尺寸，内容根据容器宽度重排
 * - 缩放 = 字体大小调整（不是整页缩放）
 * - 位置 = CFI（不是页码 + 坐标）
 * - 支持分页模式和滚动模式切换
 */
export function ReflowableContent({ renderer, onPageChange }: ReflowableContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    renderer.renderTo(containerRef.current);

    return () => {
      // 清理渲染内容
    };
  }, [renderer]);

  // 响应容器尺寸变化
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      renderer.onResize();
    });
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [renderer]);

  return (
    <div className="ebook-content ebook-content--reflowable" ref={containerRef}>
      {/* 渲染引擎将内容注入此容器 */}
    </div>
  );
}
