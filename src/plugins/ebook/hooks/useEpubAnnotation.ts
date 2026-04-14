import { useState, useCallback, useRef, useEffect } from 'react';
import type { IReflowableRenderer } from '../types';
import { isReflowable } from '../types';
import type { IBookRenderer } from '../types';

interface EpubSelection {
  cfi: string;
  text: string;
  x: number;
  y: number;
}

interface EpubAnnotation {
  id: string;
  cfi: string;
  color: string;
  text: string;
}

interface UseEpubAnnotationOptions {
  bookIdRef: React.RefObject<string | null>;
  rendererRef: React.RefObject<IBookRenderer | null>;
}

export type { EpubSelection, EpubAnnotation };

export function useEpubAnnotation({ bookIdRef, rendererRef }: UseEpubAnnotationOptions) {
  const [epubSelection, setEpubSelection] = useState<EpubSelection | null>(null);
  const [epubAnnotations, setEpubAnnotations] = useState<EpubAnnotation[]>([]);
  const epubAnnotationsRef = useRef(epubAnnotations);

  useEffect(() => { epubAnnotationsRef.current = epubAnnotations; }, [epubAnnotations]);

  /** 注册 EPUB 标注相关回调（文本选择 + 点击关闭 + 标注点击删除） */
  const registerCallbacks = useCallback((renderer: IReflowableRenderer) => {
    renderer.onTextSelected((selection) => {
      setEpubSelection(selection);
    });
    renderer.onSelectionDismiss(() => {
      setEpubSelection(null);
    });
    renderer.onAnnotationClick((cfi) => {
      const ann = epubAnnotationsRef.current.find((a) => a.cfi === cfi);
      if (ann && bookIdRef.current) {
        viewAPI.ebookAnnotationRemove(bookIdRef.current, ann.id);
        renderer.removeHighlight(cfi);
        setEpubAnnotations((prev) => prev.filter((a) => a.cfi !== cfi));
      }
    });
  }, [bookIdRef]);

  /** 加载已有标注并渲染高亮 */
  const loadAnnotations = useCallback(async (bookId: string, renderer: IReflowableRenderer) => {
    const anns = await viewAPI.ebookAnnotationList(bookId);
    setEpubAnnotations(anns);
    await renderer.getTOC(); // 等待 renderer 就绪
    for (const ann of anns) {
      if (ann.cfi) renderer.addHighlight(ann.cfi, ann.color);
    }
  }, []);

  /** 选择颜色后创建高亮 */
  const createAnnotation = useCallback(async (color: string) => {
    if (!epubSelection || !bookIdRef.current) return;
    const r = rendererRef.current;
    if (!r || !isReflowable(r)) return;

    try {
      const stored = await viewAPI.ebookAnnotationAdd(bookIdRef.current, {
        type: 'underline',
        color,
        pageNum: 0,
        rect: { x: 0, y: 0, w: 0, h: 0 },
        cfi: epubSelection.cfi,
        textContent: epubSelection.text,
      });
      r.addHighlight(epubSelection.cfi, color);
      setEpubAnnotations((prev) => [...prev, { ...stored, cfi: epubSelection.cfi }]);
      setEpubSelection(null);
    } catch { /* ignore */ }
  }, [epubSelection, bookIdRef, rendererRef]);

  const dismissSelection = useCallback(() => {
    setEpubSelection(null);
  }, []);

  return {
    epubSelection,
    epubAnnotations,
    registerCallbacks,
    loadAnnotations,
    createAnnotation,
    dismissSelection,
  };
}
