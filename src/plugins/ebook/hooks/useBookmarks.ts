import { useState, useCallback } from 'react';
import type { IBookRenderer } from '../types';
import { isFixedPage, isReflowable } from '../types';

interface UseBookmarksOptions {
  bookIdRef: React.RefObject<string | null>;
  rendererRef: React.RefObject<IBookRenderer | null>;
  epubProgress: { chapter: string; percentage: number } | null;
}

export function useBookmarks({ bookIdRef, rendererRef, epubProgress }: UseBookmarksOptions) {
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [cfiBookmarks, setCfiBookmarks] = useState<Array<{ cfi: string; label: string }>>([]);

  const loadBookmarks = useCallback((bookId: string) => {
    viewAPI.ebookBookmarkList(bookId).then(setBookmarks);
  }, []);

  const loadCfiBookmarks = useCallback((bookId: string) => {
    viewAPI.ebookCFIBookmarkList(bookId).then(setCfiBookmarks);
  }, []);

  const toggleBookmark = useCallback((currentPage: number) => {
    const bookId = bookIdRef.current;
    const r = rendererRef.current;
    if (!bookId || !r) return;

    if (isFixedPage(r)) {
      viewAPI.ebookBookmarkToggle(bookId, currentPage).then(setBookmarks);
    } else if (isReflowable(r)) {
      const cfi = r.getLastCFI();
      const label = epubProgress?.chapter || '';
      if (cfi) {
        const existing = cfiBookmarks.find((b) => b.cfi === cfi);
        if (existing) {
          viewAPI.ebookCFIBookmarkRemove(bookId, cfi).then(setCfiBookmarks);
        } else {
          viewAPI.ebookCFIBookmarkAdd(bookId, cfi, label).then(setCfiBookmarks);
        }
      }
    }
  }, [bookIdRef, rendererRef, epubProgress, cfiBookmarks]);

  const isBookmarked = useCallback((currentPage: number): boolean => {
    const r = rendererRef.current;
    if (!r) return false;
    if (r.renderMode === 'reflowable') {
      return cfiBookmarks.some((b) => b.cfi === (isReflowable(r) ? r.getLastCFI() : null));
    }
    return bookmarks.includes(currentPage);
  }, [rendererRef, bookmarks, cfiBookmarks]);

  return {
    bookmarks,
    cfiBookmarks,
    loadBookmarks,
    loadCfiBookmarks,
    toggleBookmark,
    isBookmarked,
  };
}
